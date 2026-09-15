"""Durable job ledger — the Python face of platform.jobs.

Shared by every sellable module. Each service enqueues and drains under its
own ``module_id``, so a backlog or a failure in one service cannot stall
another that a customer bought separately.

Thin on purpose. Every rule that matters (lease expiry, idempotency collapse,
retry backoff, worker-identity checks) lives in SQL, where it is enforced for
every caller and cannot be bypassed by a second client that forgets to apply
it. This class translates, it does not decide.

That split also means the semantics are tested once, in SQL, against the real
database rather than against a mock that agrees with whatever the code does.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from zeus_adapters.interfaces import Database

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Job:
    id: str
    kind: str
    payload: dict[str, Any]
    tenant_id: str | None
    status: str
    attempts: int
    max_attempts: int
    #: Which sellable module owns this work. Required, so every job is
    #: attributable to the service the customer is paying for.
    module_id: str = ""
    idempotency_key: str | None = None
    priority: int = 100
    progress_done: int | None = None
    progress_total: int | None = None
    result: dict[str, Any] | None = None
    last_error: str | None = None
    locked_by: str | None = None
    locked_until: datetime | None = None

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> Job:
        return cls(
            id=str(row["id"]),
            kind=row["kind"],
            # asyncpg hands back jsonb as a string unless a codec is registered;
            # accept both so this works regardless of pool configuration.
            payload=_as_dict(row.get("payload")) or {},
            tenant_id=str(row["tenant_id"]) if row.get("tenant_id") else None,
            status=row["status"],
            attempts=row["attempts"],
            max_attempts=row["max_attempts"],
            module_id=row.get("module_id") or "",
            idempotency_key=row.get("idempotency_key"),
            priority=row.get("priority", 100),
            progress_done=row.get("progress_done"),
            progress_total=row.get("progress_total"),
            result=_as_dict(row.get("result")),
            last_error=row.get("last_error"),
            locked_by=row.get("locked_by"),
            locked_until=row.get("locked_until"),
        )


def _as_dict(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return None


class JobRepository:
    """Ledger access scoped to a single sellable module.

    The module is fixed at construction rather than passed per call. A service
    physically cannot enqueue into, or drain from, a module it does not own,
    so the isolation that makes the services independently sellable does not
    depend on every call site remembering an argument.
    """

    def __init__(
        self,
        db: Database,
        module_id: str,
        notify: Callable[[Job], Awaitable[None]] | None = None,
    ) -> None:
        self._db = db
        self._module_id = module_id
        # Wakes a worker after a new job lands. Held here rather than called by
        # each service so that no enqueue can be written that forgets it --
        # which is exactly how grant scans came to sit queued forever in a
        # serverless deployment with nothing polling.
        self._notify = notify

    @property
    def module_id(self) -> str:
        return self._module_id

    async def enqueue(
        self,
        kind: str,
        *,
        payload: dict[str, Any] | None = None,
        tenant_id: str | None = None,
        idempotency_key: str | None = None,
        priority: int = 100,
        max_attempts: int = 3,
        run_after: datetime | None = None,
    ) -> Job:
        """Queue a job, collapsing duplicates by ``idempotency_key``.

        Returns the existing job when the key is already live, so an enqueue is
        safe to retry. The partial unique index only covers queued and running
        rows, so a key becomes reusable once its job finishes — "ingest today's
        extract" can run again tomorrow under the same key pattern.
        """
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.jobs
                (kind, module_id, payload, tenant_id, idempotency_key,
                 priority, max_attempts, run_after)
            VALUES ($1, $2, $3::jsonb, $4::uuid, $5, $6, $7, COALESCE($8, now()))
            -- Inferred form, not ON CONSTRAINT: the target is a partial unique
            -- index, which has no constraint name to reference. The predicate
            -- must match the index predicate exactly or Postgres cannot prove
            -- which index to use and rejects the statement outright.
            ON CONFLICT (kind, idempotency_key)
                WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running')
            DO NOTHING
            RETURNING *
            """,
            kind,
            self._module_id,
            json.dumps(payload or {}),
            tenant_id,
            idempotency_key,
            priority,
            max_attempts,
            run_after,
        )
        if row is not None:
            job = Job.from_row(row)
            if self._notify is not None:
                await self._notify(job)
            return job

        # DO NOTHING returned no row, meaning a live job already holds this key.
        # Return that one rather than raising: the caller asked for the work to
        # happen, and it is already going to.
        existing = await self._db.fetch_one(
            """
            SELECT * FROM platform.jobs
             WHERE kind = $1 AND idempotency_key = $2 AND module_id = $3
               AND status IN ('queued', 'running')
             LIMIT 1
            """,
            kind,
            idempotency_key,
            self._module_id,
        )
        if existing is None:
            # Raced with a job that finished between the insert and this read,
            # which frees the key. Retry once; a second miss is a real fault.
            raise RuntimeError(f"could not enqueue or locate job kind={kind}")
        # No notify here. The live job this collapsed into already published a
        # wake-up; a second one would wake a worker for work already in hand.
        log.info("jobs.deduped kind=%s key=%s", kind, idempotency_key)
        return Job.from_row(existing)

    async def claim(
        self, worker_id: str, *, lease_seconds: int = 300, kinds: list[str] | None = None
    ) -> Job | None:
        """Take the next runnable job in this module, or None if idle."""
        row = await self._db.fetch_one(
            "SELECT * FROM platform.claim_job($1, $2, $3, $4::text[])",
            worker_id,
            self._module_id,
            lease_seconds,
            kinds,
        )
        # The function returns a NULL-filled record rather than no row when
        # nothing is claimable, so test the primary key, not the row itself.
        if row is None or row.get("id") is None:
            return None
        return Job.from_row(row)

    async def heartbeat(
        self,
        job_id: str,
        worker_id: str,
        *,
        lease_seconds: int = 300,
        done: int | None = None,
        total: int | None = None,
    ) -> bool:
        """Extend the lease. False means this worker no longer owns the job.

        A false return is not a warning, it is a stop signal: another worker has
        taken over, and continuing would produce two writers for one job.
        """
        return bool(
            await self._db.fetch_one(
                "SELECT platform.heartbeat_job($1::uuid, $2, $3, $4, $5) AS ok",
                job_id,
                worker_id,
                lease_seconds,
                done,
                total,
            )
            or {}
        ).get("ok", False)

    async def finish(
        self,
        job_id: str,
        worker_id: str,
        *,
        succeeded: bool,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        retry_delay_seconds: int = 60,
    ) -> Job | None:
        row = await self._db.fetch_one(
            "SELECT * FROM platform.finish_job($1::uuid, $2, $3, $4::jsonb, $5, $6)",
            job_id,
            worker_id,
            succeeded,
            json.dumps(result) if result is not None else None,
            error,
            retry_delay_seconds,
        )
        if row is None or row.get("id") is None:
            return None
        return Job.from_row(row)

    async def get(self, job_id: str, *, tenant_id: str | None = None) -> Job | None:
        """Read one job in this module. Pass ``tenant_id`` for user-facing reads.

        Without the tenant filter this would let any authenticated user poll any
        job id and read another tenant's payload and results. The module filter
        is the same argument one level up: a service should not be able to
        surface another service's job, even to the tenant that owns both.
        """
        if tenant_id is None:
            row = await self._db.fetch_one(
                "SELECT * FROM platform.jobs WHERE id = $1::uuid AND module_id = $2",
                job_id,
                self._module_id,
            )
        else:
            row = await self._db.fetch_one(
                """
                SELECT * FROM platform.jobs
                 WHERE id = $1::uuid AND tenant_id = $2::uuid AND module_id = $3
                """,
                job_id,
                tenant_id,
                self._module_id,
            )
        return Job.from_row(row) if row else None

    async def recent_for_tenant(self, tenant_id: str, *, limit: int = 20) -> list[Job]:
        rows = await self._db.fetch(
            """
            SELECT * FROM platform.jobs
             WHERE tenant_id = $1::uuid AND module_id = $2
             ORDER BY created_at DESC
             LIMIT $3
            """,
            tenant_id,
            self._module_id,
            limit,
        )
        return [Job.from_row(r) for r in rows]

    async def queue_depth(self) -> dict[str, int]:
        """Counts by status for this module, for health checks and the admin view.

        Per-module rather than global: a queue depth that mixes services cannot
        answer the only question worth asking of it, which is whether the
        service a given customer pays for is keeping up.
        """
        rows = await self._db.fetch(
            """
            SELECT status, count(*) AS n FROM platform.jobs
             WHERE module_id = $1
             GROUP BY status
            """,
            self._module_id,
        )
        return {r["status"]: r["n"] for r in rows}
