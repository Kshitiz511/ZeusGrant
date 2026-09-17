"""Cross-module reads and operator writes against the job ledger.

Distinct from :class:`zeus_service_kit.jobs.JobRepository`, which is bound to a
single ``module_id`` at construction so a service can only ever see and claim
its own work. That binding is what keeps the modules independently sellable, and
it is the right default for every caller on the request path.

The operator is the one caller who legitimately needs to look across all of
them, because "what is stuck?" is not a question about one module. Rather than
weaken the module-bound repository with an optional escape hatch -- which would
put the escape hatch one keyword argument away from every service -- this is a
separate class, used only by the admin router, which is itself guarded by
``AdminDep``.

These queries run with no tenant bound, which is what lets them cross tenant
boundaries: every RLS policy on ``platform.jobs`` has a "no tenant bound"
branch for exactly this path.
"""

from __future__ import annotations

from typing import Any

from zeus_adapters.interfaces import Database

#: Every status the ledger's CHECK constraint permits. Defined here so the API
#: filter, the health summary and the tests all agree; a hand-written list in
#: each place is how a status gets added to the database and silently omitted
#: from the one screen that would have shown it.
JOB_STATUSES = ("queued", "running", "succeeded", "failed", "cancelled")

#: Statuses an operator can act on. Terminal-but-retryable is a different set
#: from cancellable, and conflating them is how a UI ends up offering a button
#: that always fails.
RETRYABLE_STATUSES = ("failed", "cancelled")
CANCELLABLE_STATUSES = ("queued", "running")

#: Columns safe to return in a list. Deliberately excludes ``payload`` and
#: ``result``: both hold tenant data, and a list endpoint is read casually and
#: often. The detail endpoint returns them, and that read is audited.
_LIST_COLUMNS = """
    id, kind, module_id, tenant_id, status, priority,
    attempts, max_attempts, progress_done, progress_total,
    run_after, created_at, started_at, finished_at,
    locked_by, locked_until,
    left(last_error, 500) AS last_error_excerpt,
    (last_error IS NOT NULL) AS has_error
"""


class JobAdminRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    # -- reads ---------------------------------------------------------------

    async def list_jobs(
        self,
        *,
        status: str | None = None,
        module_id: str | None = None,
        tenant_id: str | None = None,
        kind: str | None = None,
        stuck: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Newest first, filtered. ``stuck`` is defined by :meth:`_stuck_sql`."""
        where, args = self._filters(status, module_id, tenant_id, kind, stuck)
        rows = await self._db.fetch(
            f"""
            SELECT {_LIST_COLUMNS} FROM platform.jobs
             WHERE {where}
             ORDER BY created_at DESC
             LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}
            """,
            *args,
            limit,
            offset,
        )
        return [dict(r) for r in rows]

    async def count_jobs(
        self,
        *,
        status: str | None = None,
        module_id: str | None = None,
        tenant_id: str | None = None,
        kind: str | None = None,
        stuck: bool = False,
    ) -> int:
        """Total matching rows, so the console can paginate honestly."""
        where, args = self._filters(status, module_id, tenant_id, kind, stuck)
        row = await self._db.fetch_one(
            f"SELECT count(*) AS n FROM platform.jobs WHERE {where}", *args
        )
        return int(row["n"]) if row else 0

    async def get_job(self, job_id: str) -> dict[str, Any] | None:
        """One job in full, including payload, result and the whole error.

        No module or tenant filter: this is the operator's view, and a job they
        cannot open is a job they cannot fix. The router audits the read.
        """
        row = await self._db.fetch_one(
            "SELECT * FROM platform.jobs WHERE id = $1::uuid", job_id
        )
        return dict(row) if row else None

    async def queue_health(self) -> dict[str, Any]:
        """One round trip answering the questions an operator actually asks.

        Depth alone does not distinguish a busy queue from a broken one. A
        thousand queued jobs being drained steadily is healthy; fifty that have
        been waiting an hour is not. So this reports age and staleness beside
        the counts, per module, and separates the two failure shapes that need
        different responses -- an expired lease means a worker died, a backlog
        of overdue queued work means no worker is claiming at all.
        """
        rows = await self._db.fetch(
            """
            SELECT module_id, status, count(*) AS n,
                   max(EXTRACT(EPOCH FROM (now() - created_at)))::bigint AS oldest_age_seconds
              FROM platform.jobs
             GROUP BY module_id, status
            """
        )
        by_module: dict[str, dict[str, Any]] = {}
        for row in rows:
            entry = by_module.setdefault(
                row["module_id"], {"module_id": row["module_id"], "counts": {}}
            )
            entry["counts"][row["status"]] = int(row["n"])
            if row["status"] == "queued":
                entry["oldest_queued_seconds"] = int(row["oldest_age_seconds"] or 0)

        problems = await self._db.fetch_one(
            f"""
            SELECT
                count(*) FILTER (WHERE status = 'running' AND locked_until < now())
                    AS expired_leases,
                count(*) FILTER (WHERE {_OVERDUE_SQL}) AS overdue_queued,
                count(*) FILTER (
                    WHERE status = 'failed' AND finished_at > now() - interval '24 hours'
                ) AS failed_24h,
                count(*) FILTER (
                    WHERE status = 'succeeded' AND finished_at > now() - interval '24 hours'
                ) AS succeeded_24h
              FROM platform.jobs
            """
        )
        stats = dict(problems or {})
        failed = int(stats.get("failed_24h") or 0)
        succeeded = int(stats.get("succeeded_24h") or 0)
        total = failed + succeeded
        return {
            "modules": sorted(by_module.values(), key=lambda m: m["module_id"]),
            "expired_leases": int(stats.get("expired_leases") or 0),
            "overdue_queued": int(stats.get("overdue_queued") or 0),
            "failed_24h": failed,
            "succeeded_24h": succeeded,
            # None rather than 0.0 when nothing finished: a failure rate of zero
            # out of zero jobs reads as "healthy" on a dashboard when it in fact
            # means the queue did no work at all, which is the more alarming
            # state of the two.
            "failure_rate_24h": round(failed / total, 4) if total else None,
        }

    # -- operator writes -----------------------------------------------------

    async def cancel(self, job_id: str, *, reason: str) -> dict[str, Any] | None:
        row = await self._db.fetch_one(
            "SELECT * FROM platform.cancel_job($1::uuid, $2)", job_id, reason
        )
        if row is None or row.get("id") is None:
            return None
        return dict(row)

    async def retry(self, job_id: str) -> tuple[dict[str, Any] | None, str]:
        """Requeue a terminal job. Returns the row and an outcome word.

        The outcome is carried out of SQL rather than inferred from the row,
        because "nothing changed" has several causes -- already running, key
        taken by a newer job -- and they need different answers from the API.
        The row is re-read afterwards: returning the composite from plpgsql
        would arrive as an opaque tuple, and a second read of a single row by
        primary key is cheaper than the mapping code that would avoid it.
        """
        row = await self._db.fetch_one(
            "SELECT platform.retry_job($1::uuid, NULL) AS outcome", job_id
        )
        outcome = (row or {}).get("outcome") or "not_found"
        if outcome == "not_found":
            return None, outcome
        return await self.get_job(job_id), outcome

    async def reap(self, *, module_id: str | None = None, max_rows: int = 1000) -> list[dict]:
        """Recover jobs whose worker died. Returns what it touched, not a count,
        so the audit record names the jobs rather than asserting a number."""
        rows = await self._db.fetch(
            "SELECT * FROM platform.reap_expired_leases($1, $2)", module_id, max_rows
        )
        return [dict(r) for r in rows]

    # -- internals -----------------------------------------------------------

    def _filters(
        self,
        status: str | None,
        module_id: str | None,
        tenant_id: str | None,
        kind: str | None,
        stuck: bool,
    ) -> tuple[str, list[Any]]:
        clauses: list[str] = ["TRUE"]
        args: list[Any] = []
        if status:
            args.append(status)
            clauses.append(f"status = ${len(args)}")
        if module_id:
            args.append(module_id)
            clauses.append(f"module_id = ${len(args)}")
        if tenant_id:
            args.append(tenant_id)
            clauses.append(f"tenant_id = ${len(args)}::uuid")
        if kind:
            args.append(kind)
            clauses.append(f"kind = ${len(args)}")
        if stuck:
            clauses.append(_STUCK_SQL)
        return " AND ".join(clauses), args


#: A queued job is overdue when it was runnable more than five minutes ago and
#: nothing has taken it. Five minutes is one lease: shorter and ordinary
#: scheduling delay looks like a fault, longer and a dead worker goes unnoticed
#: past the point an operator could have acted on it.
_OVERDUE_SQL = "status = 'queued' AND run_after < now() - interval '5 minutes'"

#: "Stuck" as one definition, used by the list filter and the health counters
#: alike, so the number on the dashboard and the rows behind it cannot disagree.
#: Three distinct shapes, deliberately kept in one predicate:
#:   * a lease that expired while the job was still running -- the worker died;
#:   * queued and overdue -- nothing is claiming;
#:   * failed with attempts exhausted -- the retries are over and it needs a
#:     human.
_STUCK_SQL = f"""(
    (status = 'running' AND locked_until < now())
    OR ({_OVERDUE_SQL})
    OR (status = 'failed' AND attempts >= max_attempts)
)"""
