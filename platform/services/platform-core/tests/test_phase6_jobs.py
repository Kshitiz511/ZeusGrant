"""Phase 6 -- operator control over the job ledger.

Four things are asserted here, in order of how much damage their absence does:

1. **Cancel stops the work, not just the label.** The whole point of cancelling
   a runaway extraction is that it stops costing money. A cancel that flipped
   the status while the handler ran on would be worse than no cancel at all,
   because it would report success for something that did not happen.
2. **Retry resets the attempt count** (question Q6), and refuses when a live job
   already holds the idempotency key rather than surfacing a unique violation
   as a 500.
3. **The reaper recovers leases with no claim traffic** (defect D12) -- the
   situation the in-``claim_job`` sweep cannot reach, because nothing is
   claiming.
4. **The list does not leak tenant data** and the detail read is audited.

The SQL functions are exercised against real Postgres by
``scripts/probe_phase6_jobs.py``; these tests cover the HTTP contract and the
decisions encoded in the router, using a fake database.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.repositories.jobs_admin import (
    CANCELLABLE_STATUSES,
    JOB_STATUSES,
    RETRYABLE_STATUSES,
    JobAdminRepository,
)
from zeus_platform_core.security import PLATFORM_ADMIN_ROLE
from zeus_service_kit.worker import HandlerRegistry, JobContext, JobLost, Worker

TENANT = "11111111-1111-1111-1111-111111111111"
ADMIN_USER = "22222222-2222-2222-2222-222222222222"
JOB = "33333333-3333-3333-3333-333333333333"
AUTH = {"authorization": "Bearer admin-token"}


class StubAuth:
    def __init__(self, roles: list[str]) -> None:
        self._roles = roles

    async def verify(self, token: str) -> Session:
        return Session(
            user_id=ADMIN_USER,
            tenant_id=None,
            email="ops@zeus.test",
            roles=self._roles,
        )


def _job_row(**overrides: Any) -> dict[str, Any]:
    row = {
        "id": JOB,
        "kind": "contract.analyze",
        "module_id": "contract_compliance",
        "tenant_id": TENANT,
        "status": "running",
        "priority": 100,
        "attempts": 2,
        "max_attempts": 3,
        "progress_done": 1,
        "progress_total": 2,
        "payload": {"contract_id": "c-1", "secret_note": "tenant data"},
        "result": None,
        "last_error": None,
        "locked_by": "worker-a",
        "locked_until": None,
        "run_after": None,
        "created_at": None,
        "started_at": None,
        "finished_at": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def stack() -> Iterator[tuple[TestClient, FakeDatabase, list[tuple]]]:
    db = FakeDatabase()
    container = Container(db=db, cache=MemoryCache(), auth=StubAuth([PLATFORM_ADMIN_ROLE]))

    audited: list[tuple] = []
    real_execute = db.execute

    async def capture(query: str, *args):
        if "admin_audit" in query:
            audited.append(args)
        return await real_execute(query, *args)

    db.execute = capture  # type: ignore[method-assign]
    db.on_fetch_one("FROM platform.users", lambda args: {"email": "ops@zeus.test"})
    yield TestClient(create_app(container)), db, audited


# --- 1. the status vocabulary is defined once --------------------------------


def test_the_status_list_matches_the_database_check_constraint():
    """Four copies of this list already existed in SQL, tests and prose.

    A status added to the constraint and forgotten here would be invisible to
    the one screen built to show it, and the filter would reject it as invalid.
    """
    assert set(JOB_STATUSES) == {"queued", "running", "succeeded", "failed", "cancelled"}


def test_cancellable_and_retryable_do_not_overlap():
    """They are different questions, and conflating them produces a UI button
    that is offered exactly when it cannot work."""
    assert not set(CANCELLABLE_STATUSES) & set(RETRYABLE_STATUSES)
    assert set(CANCELLABLE_STATUSES) | set(RETRYABLE_STATUSES) <= set(JOB_STATUSES)


# --- 2. cancel actually stops the handler ------------------------------------


def test_heartbeat_returns_a_boolean_and_does_not_raise():
    """Defect D20.

    ``heartbeat`` read ``bool(row or {}).get("ok")`` -- ``.get`` applied to a
    boolean -- so every call raised AttributeError. It survived because both
    callers hid it: the worker's background keepalive catches Exception and
    logs a warning, and no test ever called it with a database that returned a
    row.

    The consequence was that no lease was ever extended. Any handler running
    longer than the five-minute lease was reaped and retried mid-flight, and any
    handler calling ``ctx.progress`` failed outright on its first checkpoint.
    """
    db = FakeDatabase()
    db.on_fetch_one("heartbeat_job", lambda args: {"ok": True})
    repo = _repo_for(db)

    assert asyncio.run(repo.heartbeat(JOB, "worker-a")) is True


def test_heartbeat_treats_a_null_result_as_a_lost_lease():
    """The function is ``UPDATE ... RETURNING true``, so a non-match yields NULL
    rather than false. Reading that as truthy would let two workers write one
    job's result."""
    db = FakeDatabase()
    db.on_fetch_one("heartbeat_job", lambda args: {"ok": None})
    repo = _repo_for(db)

    assert asyncio.run(repo.heartbeat(JOB, "worker-a")) is False


def test_progress_raises_job_lost_once_the_job_is_no_longer_running():
    """This is what makes cancel bite rather than relabel.

    ``heartbeat_job`` requires status = 'running', so a cancelled job fails its
    handler's next heartbeat. Without this the handler would run to completion
    -- and to full model spend -- after the operator was told it had stopped.
    """
    db = FakeDatabase()
    # The SQL function returns NULL when the row is no longer running or the
    # lease has moved on; the repository coerces that to False.
    db.on_fetch_one("heartbeat_job", lambda args: {"ok": None})
    container = Container(db=db, cache=MemoryCache(), auth=StubAuth([]))
    worker = Worker(
        jobs=_repo_for(db),
        container=container,
        handlers=HandlerRegistry(),
        worker_id="worker-a",
    )
    ctx = JobContext(job=_fake_job(), container=container, _worker=worker)

    with pytest.raises(JobLost):
        asyncio.run(ctx.progress(1, 2))


def test_cancelling_a_finished_job_is_a_conflict_not_a_silent_success(stack):
    """The operator pressed cancel expecting something to stop.

    Reporting 'cancelled' for a job that already succeeded would discard a real
    result in the ledger's account of what happened.
    """
    client, db, _ = stack
    db.on_fetch_one("cancel_job", lambda args: _job_row(status="succeeded"))

    resp = client.post(f"/admin/jobs/{JOB}/cancel", headers=AUTH, json={"reason": "x"})

    assert resp.status_code == 409
    assert "succeeded" in resp.json()["detail"]


def test_a_successful_cancel_is_audited_with_the_reason(stack):
    client, db, audited = stack
    db.on_fetch_one("cancel_job", lambda args: _job_row(status="cancelled"))

    resp = client.post(
        f"/admin/jobs/{JOB}/cancel", headers=AUTH, json={"reason": "runaway spend"}
    )

    assert resp.status_code == 200
    assert [a[2] for a in audited] == ["job.cancelled"]


def test_cancel_requires_a_reason(stack):
    """Why a job was cancelled is asked later by someone who was not there."""
    client, _, _ = stack

    assert client.post(f"/admin/jobs/{JOB}/cancel", headers=AUTH, json={}).status_code == 422
    assert (
        client.post(
            f"/admin/jobs/{JOB}/cancel", headers=AUTH, json={"reason": ""}
        ).status_code
        == 422
    )


# --- 3. retry (question Q6) --------------------------------------------------


def test_retrying_a_live_job_is_refused_rather_than_duplicating_the_work(stack):
    client, db, _ = stack
    db.on_fetch_one("retry_job", lambda args: {"outcome": "not_retryable"})
    db.on_fetch_one("FROM platform.jobs WHERE id", lambda args: _job_row(status="running"))

    resp = client.post(f"/admin/jobs/{JOB}/retry", headers=AUTH)

    assert resp.status_code == 409
    assert "running" in resp.json()["detail"]


def test_a_superseded_retry_is_a_conflict_not_a_500(stack):
    """The partial unique index would otherwise surface as an integrity error.

    A newer live job already holds this idempotency key, so the work is in hand.
    That is a conflict with a clear explanation, not a server fault.
    """
    client, db, _ = stack
    db.on_fetch_one("retry_job", lambda args: {"outcome": "superseded"})
    db.on_fetch_one("FROM platform.jobs WHERE id", lambda args: _job_row(status="failed"))

    resp = client.post(f"/admin/jobs/{JOB}/retry", headers=AUTH)

    assert resp.status_code == 409
    assert "idempotency key" in resp.json()["detail"]


def test_a_successful_retry_is_audited(stack):
    client, db, audited = stack
    db.on_fetch_one("retry_job", lambda args: {"outcome": "requeued"})
    db.on_fetch_one(
        "FROM platform.jobs WHERE id", lambda args: _job_row(status="queued", attempts=0)
    )

    resp = client.post(f"/admin/jobs/{JOB}/retry", headers=AUTH)

    assert resp.status_code == 200
    assert resp.json()["outcome"] == "requeued"
    assert [a[2] for a in audited] == ["job.retried"]


def test_a_missing_job_is_404_on_every_action(stack):
    client, db, _ = stack
    db.on_fetch_one("retry_job", lambda args: {"outcome": "not_found"})
    db.on_fetch_one("cancel_job", lambda args: None)
    db.on_fetch_one("FROM platform.jobs WHERE id", lambda args: None)

    assert client.post(f"/admin/jobs/{JOB}/retry", headers=AUTH).status_code == 404
    assert (
        client.post(
            f"/admin/jobs/{JOB}/cancel", headers=AUTH, json={"reason": "x"}
        ).status_code
        == 404
    )
    assert client.get(f"/admin/jobs/{JOB}", headers=AUTH).status_code == 404


# --- 4. the list does not leak, the detail is audited ------------------------


def test_the_list_never_returns_payloads_or_results(stack):
    """A list is read casually and often; payloads hold customer documents.

    Asserted against the SQL rather than the response, because a fake database
    returns whatever it is told -- what matters is that the query does not ask
    for the columns in the first place.
    """
    client, db, _ = stack
    db.on_fetch("FROM platform.jobs", lambda args: [])
    db.on_fetch_one("count(*)", lambda args: {"n": 0})

    client.get("/admin/jobs", headers=AUTH)

    select = next(
        q for _, q, _ in db.calls if "FROM platform.jobs" in q and "SELECT" in q
    )
    assert "payload" not in select
    assert "result" not in select
    assert "last_error_excerpt" in select, "an excerpt is useful; the full trace is not"


def test_opening_one_job_is_audited_because_it_returns_tenant_data(stack):
    """The only route on the platform that hands an operator another tenant's
    data. A record of who opened which job is what separates a support tool
    from an unaccountable one."""
    client, db, audited = stack
    db.on_fetch_one("FROM platform.jobs WHERE id", lambda args: _job_row())

    resp = client.get(f"/admin/jobs/{JOB}", headers=AUTH)

    assert resp.status_code == 200
    assert resp.json()["job"]["payload"]["secret_note"] == "tenant data"
    assert [a[2] for a in audited] == ["job.viewed"]


def test_the_health_endpoint_is_not_audited(stack):
    """It is refreshed repeatedly during an incident. Recording every read
    would bury the actions that actually changed something."""
    client, db, audited = stack
    db.on_fetch("GROUP BY module_id", lambda args: [])
    db.on_fetch_one("expired_leases", lambda args: {})

    assert client.get("/admin/jobs/health", headers=AUTH).status_code == 200
    assert audited == []


def test_health_reports_no_failure_rate_when_nothing_ran(stack):
    """Zero out of zero is not a healthy zero per cent.

    A dashboard showing 0.0% for a queue that did no work reads as green when
    it is the more alarming of the two states.
    """
    client, db, _ = stack
    db.on_fetch("GROUP BY module_id", lambda args: [])
    db.on_fetch_one("expired_leases", lambda args: {})

    assert client.get("/admin/jobs/health", headers=AUTH).json()["failure_rate_24h"] is None


# --- 5. the reaper (defect D12) ----------------------------------------------


def test_reaping_nothing_writes_no_audit_row(stack):
    """A sweep that found nothing is not an action. Recording it would fill the
    trail with noise on whatever schedule the sweep runs."""
    client, db, audited = stack
    db.on_fetch("reap_expired_leases", lambda args: [])

    resp = client.post("/admin/jobs/reap", headers=AUTH, json={})

    assert resp.status_code == 200
    assert resp.json()["count"] == 0
    assert audited == []


def test_reaping_records_which_jobs_it_touched(stack):
    """The count alone cannot be checked afterwards; the ids can."""
    client, db, audited = stack
    db.on_fetch(
        "reap_expired_leases",
        lambda args: [
            {"id": JOB, "module_id": "m", "kind": "k", "attempts": 1, "outcome": "requeued"},
        ],
    )

    client.post("/admin/jobs/reap", headers=AUTH, json={})

    assert [a[2] for a in audited] == ["jobs.reaped"]


def test_a_reap_sweep_is_bounded(stack):
    """An unbounded UPDATE would hold locks while the queue stalls behind it."""
    client, _, _ = stack

    resp = client.post("/admin/jobs/reap", headers=AUTH, json={"max_rows": 999999})

    assert resp.status_code == 422


# --- 6. filters --------------------------------------------------------------


def test_an_unknown_status_filter_is_rejected(stack):
    client, _, _ = stack

    assert client.get("/admin/jobs?status=exploded", headers=AUTH).status_code == 422


def test_the_stuck_filter_covers_all_three_failure_shapes():
    """One definition, shared by the list and the health counters, so the
    number on the dashboard and the rows behind it cannot disagree."""
    from zeus_platform_core.repositories.jobs_admin import _STUCK_SQL

    assert "locked_until < now()" in _STUCK_SQL, "a worker died mid-run"
    assert "run_after <" in _STUCK_SQL, "queued but nothing is claiming"
    assert "attempts >= max_attempts" in _STUCK_SQL, "retries exhausted"


def test_filters_are_parameterised_not_interpolated():
    """Tenant and kind arrive from the query string."""
    repo = JobAdminRepository(FakeDatabase())
    where, args = repo._filters("failed", None, TENANT, "'; DROP TABLE", False)

    assert "DROP TABLE" not in where
    assert args == ["failed", TENANT, "'; DROP TABLE"]


# --- helpers -----------------------------------------------------------------


def _fake_job():
    from zeus_service_kit.jobs import Job

    return Job(
        id=JOB,
        kind="contract.analyze",
        payload={},
        tenant_id=TENANT,
        status="running",
        attempts=1,
        max_attempts=3,
        module_id="contract_compliance",
    )


def _repo_for(db: FakeDatabase):
    from zeus_service_kit.jobs import JobRepository

    return JobRepository(db, module_id="contract_compliance")
