#!/usr/bin/env python3
"""Phase 6 probe: the job SQL functions against real Postgres.

The unit tests cover the HTTP contract with a fake database. They cannot tell
you whether ``reap_expired_leases`` actually recovers a lease, because that
depends on row locking, ``now()`` and the partial unique index -- none of which
a fake reproduces. This runs the real functions against real rows.

Everything happens inside a transaction that is rolled back, so the ledger is
left exactly as it was found.

Refuses to run against anything but a local database. Migrating production by
accident is how defect D20's sibling, D21, got written.

    uv run --with asyncpg python scripts/probe_phase6_jobs.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

LOCAL_DSN = "postgresql://zeus:zeus@localhost:5433/zeus"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}  {detail}")


def refuse_if_not_local(dsn: str) -> None:
    host = dsn.split("@")[-1].split("/")[0]
    if not host.startswith(("localhost", "127.0.0.1", "[::1]")):
        print(f"Refusing to run against a non-local database: {host}")
        sys.exit(1)


async def main() -> int:
    import asyncpg

    dsn = os.environ.get("ZEUS_PROBE_URL", LOCAL_DSN)
    refuse_if_not_local(dsn)
    print(f"\nPhase 6 job operations against {dsn.split('@')[-1]}\n")

    conn = await asyncpg.connect(dsn, timeout=15)
    tx = conn.transaction()
    await tx.start()
    try:
        module = await conn.fetchval("SELECT id FROM platform.modules LIMIT 1")
        if module is None:
            print("No modules seeded; run migrations first.")
            return 1

        async def make_job(**kw) -> uuid.UUID:
            # jobs_running_has_lease forbids a running row without a lease, so a
            # running job is always inserted with a live one and expired
            # afterwards by expire(). The constraint is right to refuse: a
            # running row with no lease is unrecoverable, since nothing would
            # ever sweep it.
            return await conn.fetchval(
                """
                INSERT INTO platform.jobs
                    (kind, payload, module_id, status, attempts, max_attempts,
                     locked_by, locked_until, idempotency_key, run_after, last_error)
                VALUES ($1, '{}'::jsonb, $2, $3, $4, $5, $6,
                        CASE WHEN $3 = 'running' THEN now() + interval '5 minutes' END,
                        $7, COALESCE($8, now()), $9)
                RETURNING id
                """,
                kw.get("kind", "probe.kind"),
                module,
                kw.get("status", "queued"),
                kw.get("attempts", 0),
                kw.get("max_attempts", 3),
                kw.get("locked_by"),
                kw.get("idempotency_key"),
                kw.get("run_after"),
                kw.get("last_error"),
            )

        async def expire(job_id: uuid.UUID) -> None:
            await conn.execute(
                "UPDATE platform.jobs SET locked_until = now() - interval '1 hour' "
                "WHERE id = $1",
                job_id,
            )

        # --- the reaper (defect D12) ---------------------------------------
        print("Reaper")
        stranded = await make_job(status="running", attempts=1, locked_by="dead-worker")
        # An expired lease has to be set by SQL expression: asyncpg will not
        # accept "now() - interval '1 hour'" as a bound parameter.
        await expire(stranded)
        reaped = await conn.fetch("SELECT * FROM platform.reap_expired_leases($1, 100)", module)
        row = await conn.fetchrow("SELECT * FROM platform.jobs WHERE id = $1", stranded)
        check(
            "a job whose worker died is requeued with no claim traffic",
            row["status"] == "queued",
            f"status={row['status']}",
        )
        check("its lease is released", row["locked_by"] is None and row["locked_until"] is None)
        check("the reaper reports what it touched", any(r["id"] == stranded for r in reaped))
        check(
            "the cause is recorded",
            "lease expired" in (row["last_error"] or ""),
            str(row["last_error"]),
        )

        exhausted = await make_job(status="running", attempts=3, locked_by="dead")
        await expire(exhausted)
        await conn.fetch("SELECT * FROM platform.reap_expired_leases($1, 100)", module)
        row = await conn.fetchrow(
            "SELECT status, finished_at FROM platform.jobs WHERE id = $1", exhausted
        )
        check(
            "a job out of attempts is failed, not requeued forever",
            row["status"] == "failed" and row["finished_at"] is not None,
            f"status={row['status']}",
        )

        keep = await make_job(status="running", locked_by="live-worker")
        await conn.fetch("SELECT * FROM platform.reap_expired_leases(NULL, 100)")
        row = await conn.fetchrow("SELECT status FROM platform.jobs WHERE id = $1", keep)
        check("a healthy lease is left alone", row["status"] == "running")

        prior = await make_job(status="running", attempts=1, locked_by="d", last_error="boom")
        await expire(prior)
        await conn.fetch("SELECT * FROM platform.reap_expired_leases(NULL, 100)")
        row = await conn.fetchrow("SELECT last_error FROM platform.jobs WHERE id = $1", prior)
        check(
            "a real handler error survives being reaped",
            "boom" in row["last_error"] and "reaped" in row["last_error"],
            row["last_error"],
        )

        # --- cancel (defect D10) -------------------------------------------
        print("\nCancel")
        target = await make_job(status="running", locked_by="worker-a")
        cancelled = await conn.fetchrow(
            "SELECT * FROM platform.cancel_job($1, $2)", target, "operator stopped it"
        )
        check("a running job can be cancelled", cancelled["status"] == "cancelled")
        check(
            "the lease is cleared so the handler's next heartbeat fails",
            cancelled["locked_by"] is None,
        )
        beat = await conn.fetchval(
            "SELECT platform.heartbeat_job($1, $2, 300, NULL, NULL)", target, "worker-a"
        )
        check("the running worker is told it lost the job", beat is None, str(beat))
        finished = await conn.fetchrow(
            "SELECT * FROM platform.finish_job($1, $2, true, '{}'::jsonb, NULL, 60)",
            target,
            "worker-a",
        )
        check(
            "a cancelled job cannot be overwritten by its old worker",
            finished["id"] is None,
        )

        done = await make_job(status="succeeded")
        unchanged = await conn.fetchrow("SELECT * FROM platform.cancel_job($1, NULL)", done)
        check(
            "cancelling a finished job does not rewrite history",
            unchanged["status"] == "succeeded",
        )

        # --- retry (question Q6) -------------------------------------------
        print("\nRetry")
        dead = await make_job(status="failed", attempts=3, last_error="upstream 503")
        outcome = await conn.fetchval("SELECT platform.retry_job($1, NULL)", dead)
        row = await conn.fetchrow("SELECT * FROM platform.jobs WHERE id = $1", dead)
        check("a failed job is requeued", outcome == "requeued" and row["status"] == "queued")
        check("the attempt count is reset", row["attempts"] == 0, str(row["attempts"]))
        check("the previous failure stays visible", "upstream 503" in row["last_error"])
        check("it is runnable immediately", row["finished_at"] is None)

        live = await make_job(status="running", locked_by="w")
        check(
            "a running job cannot be retried into a second worker",
            await conn.fetchval("SELECT platform.retry_job($1, NULL)", live) == "not_retryable",
        )

        key = f"probe-{uuid.uuid4()}"
        old = await make_job(status="failed", attempts=3, idempotency_key=key)
        await make_job(status="queued", idempotency_key=key)
        check(
            "a retry blocked by a newer live job is reported, not a unique violation",
            await conn.fetchval("SELECT platform.retry_job($1, NULL)", old) == "superseded",
        )

        check(
            "an unknown job is reported as such",
            await conn.fetchval("SELECT platform.retry_job($1, NULL)", uuid.uuid4())
            == "not_found",
        )

        # --- backoff (defect D19) ------------------------------------------
        print("\nBackoff")
        retrying = await make_job(status="running", attempts=2, locked_by="w")
        await conn.fetchrow(
            "SELECT * FROM platform.finish_job($1, $2, false, NULL, 'err', 120)",
            retrying,
            "w",
        )
        delay = await conn.fetchval(
            "SELECT EXTRACT(EPOCH FROM (run_after - now())) FROM platform.jobs WHERE id = $1",
            retrying,
        )
        check(
            "the caller's backoff is used once, not squared",
            115 <= float(delay) <= 125,
            f"{float(delay):.0f}s, expected ~120s",
        )

        print(f"\n{passed} passed, {failed} failed\n")
        return 1 if failed else 0
    finally:
        await tx.rollback()
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
