"""End-to-end tests for the Contract Compliance service.

Uses the real FastAPI app with injected fakes: a fake database, an in-memory
cache seeded with entitlement claims, a stub auth provider, and a fake LLM.
Proves the module independently enforces entitlement and its plan limit, and
that AI extraction persists obligations.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Extraction, Session
from zeus_adapters.queue.memory_queue import MemoryQueue
from zeus_contract_compliance.app import create_app
from zeus_contract_compliance.container import Container

TENANT = "22222222-2222-2222-2222-222222222222"


class StubAuth:
    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id="u1", email="u@example.com", tenant_id=TENANT, roles=[])

    async def issue_claims(self, user_id, tenant_id, roles):  # pragma: no cover
        return "stub"


class FakeLlm:
    """Returns two obligations regardless of input."""

    async def generate(self, messages, *, model=None, temperature=0.2):  # pragma: no cover
        raise NotImplementedError

    async def extract(self, schema, text, *, instructions=None) -> Extraction:
        return Extraction(
            data={
                "obligations": [
                    {
                        "description": "Deliver Q1 report",
                        "due_date": "2026-03-31",
                        "priority": "high",
                    },
                    {"description": "Pay invoice", "priority": "medium"},
                ]
            },
            model="fake-model",
            # Real providers always report usage; the fake does too, so metering
            # is exercised rather than silently skipped in tests.
            prompt_tokens=100,
            completion_tokens=25,
        )

    async def embed(self, text):  # pragma: no cover
        raise NotImplementedError


def _seed_cache(cache: MemoryCache, *, contracts_max: int | None) -> None:
    claims = {
        "tenant_id": TENANT,
        "modules": {
            "contract_compliance": {
                "status": "active",
                "plan_id": "cc_growth",
                "limits": {"contracts_max": contracts_max},
            }
        },
    }
    # MemoryCache stores (value, expires) tuples; seed directly.
    cache._store[f"entitlements:{TENANT}"] = (json.dumps(claims), None)  # noqa: SLF001


def _build(*, entitled: bool, contracts_max: int | None = 5, contract_count: int = 0, llm=None):
    db = FakeDatabase()
    created: list[dict] = []

    db.on_fetch_one(
        "INSERT INTO contract_compliance.contracts",
        lambda args: {
            "id": "c-1",
            "tenant_id": args[0],
            "title": args[1],
            "counterparty": args[2],
            "body": args[3],
            "status": "draft",
            "created_at": None,
        },
    )
    db.on_fetch_one(
        "COUNT(*) AS n",
        lambda args: {"n": contract_count},
    )
    db.on_fetch_one(
        "INSERT INTO platform.jobs",
        lambda args: {
            "id": "job-1",
            "kind": args[0],
            "module_id": args[1],
            "payload": args[2],
            "tenant_id": args[3],
            "idempotency_key": args[4],
            "priority": args[5],
            "max_attempts": args[6],
            "status": "queued",
            "attempts": 0,
        },
    )
    db.on_fetch_one(
        "AND id = $2",
        lambda args: {
            "id": "c-1",
            "tenant_id": TENANT,
            "title": "Test",
            "counterparty": None,
            "body": "Vendor shall deliver the Q1 report by March 31.",
            "status": "draft",
            "created_at": None,
        },
    )
    db.on_fetch(
        "FROM contract_compliance.obligations",
        lambda args: created,
    )
    db.on_execute(
        "INSERT INTO contract_compliance.obligations",
        lambda args: created.append(
            {
                "id": f"o-{len(created)}",
                "contract_id": args[0],
                "tenant_id": args[1],
                "description": args[2],
                "due_date": args[3],
                "responsible": args[4],
                "priority": args[5],
                "status": "open",
                "source": "ai",
            }
        )
        or "OK",
    )

    cache = MemoryCache()
    if entitled:
        _seed_cache(cache, contracts_max=contracts_max)
    else:
        cache._store[f"entitlements:{TENANT}"] = (  # noqa: SLF001
            json.dumps({"tenant_id": TENANT, "modules": {}}),
            None,
        )

    container = Container(
        db=db, cache=cache, auth=StubAuth(), llm=llm or FakeLlm(), queue=MemoryQueue()
    )
    container.settings.worker_secret = _Secret("worker-secret")
    client = TestClient(create_app(container))
    # Exposed so tests can assert on what was written, not just on status codes.
    client.fake_db = db
    return client


class _Secret:
    """Minimal stand-in for pydantic SecretStr in tests."""

    def __init__(self, value: str) -> None:
        self._value = value

    def get_secret_value(self) -> str:
        return self._value


def _auth():
    return {"Authorization": "Bearer good-token"}


def test_health_open():
    client = _build(entitled=True)
    assert client.get("/health").status_code == 200


def test_no_token_is_401():
    client = _build(entitled=True)
    assert client.get("/contracts").status_code == 401


def test_unentitled_tenant_forbidden():
    client = _build(entitled=False)
    assert client.get("/contracts", headers=_auth()).status_code == 403


def test_create_contract_allowed_when_entitled():
    client = _build(entitled=True, contracts_max=5, contract_count=0)
    resp = client.post("/contracts", headers=_auth(), json={"title": "MSA"})
    assert resp.status_code == 201
    assert resp.json()["title"] == "MSA"


def test_contract_limit_enforced():
    client = _build(entitled=True, contracts_max=1, contract_count=1)
    resp = client.post("/contracts", headers=_auth(), json={"title": "Second"})
    assert resp.status_code == 402


def test_ai_analyze_persists_obligations():
    client = _build(entitled=True)
    resp = client.post("/contracts/c-1/analyze", headers=_auth())
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert {o["description"] for o in body} == {"Deliver Q1 report", "Pay invoice"}
    assert all(o["source"] == "ai" for o in body)


def _usage_inserts(db):
    return [
        args
        for kind, query, args in db.calls
        if kind == "execute" and "INSERT INTO platform.ai_usage" in query
    ]


def _job_inserts(db):
    return [
        args
        for kind, query, args in db.calls
        if "INSERT INTO platform.jobs" in query
    ]


def test_successful_analysis_is_metered_with_real_token_counts():
    client = _build(entitled=True)
    client.post("/contracts/c-1/analyze", headers=_auth())
    (args,) = _usage_inserts(client.fake_db)
    assert args[0] == TENANT
    assert args[5] == 100  # prompt tokens, as reported by the provider
    assert args[6] == 25  # completion tokens
    assert args[9] is True  # succeeded


class ExplodingLlm(FakeLlm):
    async def extract(self, schema, text, *, instructions=None):
        raise RuntimeError("provider exploded")


def test_failed_analysis_is_metered_to_the_same_ledger():
    """A failure must land in the same table as a success.

    These were split once: successes went to platform.ai_usage while failures
    went to the module's own table. Nothing crashed, but every rollup built on
    the shared ledger reported a 100% success rate by construction, and the
    budget burned by failures was invisible.
    """
    client = _build(entitled=True, llm=ExplodingLlm())
    resp = client.post("/contracts/c-1/analyze", headers=_auth())
    assert resp.status_code == 503

    (args,) = _usage_inserts(client.fake_db)
    assert args[0] == TENANT
    assert args[9] is False  # succeeded
    assert "provider exploded" in args[10]


def test_async_analyze_enqueues_and_returns_202():
    client = _build(entitled=True)
    resp = client.post("/contracts/c-1/analyze?async_mode=true", headers=_auth())
    assert resp.status_code == 202
    assert resp.json() == []
    # A pollable job id, not a bare acknowledgement: the client has to be able
    # to ask whether the work finished.
    assert resp.headers["X-Job-Id"]

    # The job is recorded in the ledger under this module, which is what makes
    # it survive a dropped queue message.
    (args,) = _job_inserts(client.fake_db)
    assert args[0] == "contract.analyze"
    assert args[1] == "contract_compliance"
    assert json.loads(args[2]) == {"tenant_id": TENANT, "contract_id": "c-1"}
    # Keyed on the contract so a double-clicked button cannot start a second
    # analysis that deletes the first one's obligations mid-write.
    assert args[4] == f"analyze:{TENANT}:c-1"


def test_worker_endpoint_requires_secret():
    client = _build(entitled=True)
    bad = client.post("/internal/jobs/run", json={"secret": "nope"})
    assert bad.status_code == 403


def test_worker_endpoint_drains_its_own_module():
    client = _build(entitled=True)
    ok = client.post("/internal/jobs/run", json={"secret": "worker-secret"})
    assert ok.status_code == 200
    body = ok.json()
    # A worker only ever drains the module it belongs to, which is what keeps
    # one service's backlog from delaying another that was sold separately.
    assert body["module_id"] == "contract_compliance"
    assert body["jobs_run"] == 0  # nothing queued in this fixture
