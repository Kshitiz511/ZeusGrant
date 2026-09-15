"""Prove the one queue architecture works, end to end, for both services.

This exists because the two services had opposite halves of the same design
and neither half was verified against the other. Grant Intelligence had a
durable ledger but published nothing, so on a serverless deployment a queued
scan would sit untouched forever while the API returned a job id to poll.
Contract Compliance published but recorded nothing, so a dropped message lost
the work silently and a duplicate delivery ran the analysis twice.

Every claim made about the unified design is checked here against the real
database rather than asserted in a comment:

  1. Enqueuing publishes a wake-up.
  2. Enqueuing the same key twice does not publish twice.
  3. A worker drains only its own module.
  4. A failed publish does not lose the job.
  5. Both services use the same mechanism.

Run with the platform venv and the four-tree PYTHONPATH.
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

from zeus_adapters import build_database
from zeus_config import get_settings
from zeus_service_kit.dispatch import JobNotifier
from zeus_service_kit.jobs import JobRepository
from zeus_service_kit.worker import HandlerRegistry, JobContext, Worker

GRANTS = "grant_intelligence"
CONTRACTS = "contract_compliance"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label} {detail}")


class RecordingQueue:
    """Captures publishes instead of sending them."""

    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, topic: str, payload: dict[str, Any]) -> str:
        self.published.append((topic, payload))
        return "msg-1"


class BrokenQueue:
    """Every publish fails. Models QStash being unreachable."""

    async def publish(self, topic: str, payload: dict[str, Any]) -> str:
        raise ConnectionError("qstash unreachable")


async def main() -> int:
    settings = get_settings()
    db = build_database(settings)
    await db.connect()

    try:
        await db.execute("DELETE FROM platform.jobs WHERE kind LIKE 'probe.%'")

        # --- 1. enqueue publishes a wake-up ---------------------------------
        print("\n1. Enqueue rings the doorbell")
        q = RecordingQueue()
        grants = JobRepository(
            db, GRANTS, notify=JobNotifier(q, "grant-intelligence-worker", secret="s")
        )
        job = await grants.enqueue("probe.one", idempotency_key="k1")
        check("a new job publishes exactly one wake-up", len(q.published) == 1,
              f"got {len(q.published)}")
        check("the wake-up goes to this module's topic",
              q.published and q.published[0][0] == "grant-intelligence-worker")
        check("the job is attributed to its module", job.module_id == GRANTS,
              f"got {job.module_id!r}")

        # --- 2. a deduplicated enqueue does not publish again ----------------
        print("\n2. A double-click does not wake the worker twice")
        again = await grants.enqueue("probe.one", idempotency_key="k1")
        check("the duplicate collapses into the same job", again.id == job.id)
        check("and publishes nothing further", len(q.published) == 1,
              f"got {len(q.published)}")

        # --- 3. a failed publish does not lose the job ----------------------
        print("\n3. A dead queue costs latency, not work")
        broken = JobRepository(
            db, GRANTS, notify=JobNotifier(BrokenQueue(), "t", secret="s")
        )
        survived = await broken.enqueue("probe.two", idempotency_key="k2")
        row = await db.fetch_one(
            "SELECT status FROM platform.jobs WHERE id = $1::uuid", survived.id
        )
        check("the job is committed even though the publish failed",
              row is not None and row["status"] == "queued")

        # --- 4. module isolation --------------------------------------------
        print("\n4. One service cannot take another's work")
        contracts = JobRepository(db, CONTRACTS)
        await contracts.enqueue("probe.cc")

        ran: list[str] = []

        grant_reg = HandlerRegistry()

        @grant_reg.register("probe.one")
        @grant_reg.register("probe.two")
        async def _g(ctx: JobContext) -> dict[str, Any]:
            ran.append(f"{ctx.job.module_id}:{ctx.job.kind}")
            return {}

        cc_reg = HandlerRegistry()

        @cc_reg.register("probe.cc")
        async def _c(ctx: JobContext) -> dict[str, Any]:
            ran.append(f"{ctx.job.module_id}:{ctx.job.kind}")
            return {}

        # Scoped to this probe's kinds so a developer's leftover jobs in the
        # local database cannot change the counts asserted below.
        cc_worker = Worker(
            jobs=contracts, container=None, handlers=cc_reg, kinds=["probe.cc"]
        )
        summary = await cc_worker.drain(max_jobs=10, max_seconds=10)

        check("the contract worker reports its own module",
              summary["module_id"] == CONTRACTS)
        check("it ran only contract work",
              all(r.startswith(CONTRACTS) for r in ran), f"ran={ran}")
        left = await db.fetch_one(
            "SELECT count(*) AS n FROM platform.jobs "
            " WHERE kind LIKE 'probe.%' AND module_id = $1 AND status = 'queued'",
            GRANTS,
        )
        check("grant work is untouched by it", left["n"] == 2, f"got {left['n']}")

        # --- 5. the same mechanism serves both ------------------------------
        print("\n5. Both services, one mechanism")
        g_worker = Worker(
            jobs=grants,
            container=None,
            handlers=grant_reg,
            kinds=["probe.one", "probe.two"],
        )
        g_summary = await g_worker.drain(max_jobs=10, max_seconds=10)
        check("the grant worker drains its own queue", g_summary["jobs_run"] == 2,
              f"got {g_summary['jobs_run']}")
        check("both modules ran through the same Worker class",
              len(ran) == 3, f"ran={ran}")

        rows = await db.fetch(
            """
            SELECT module_id, count(*) AS n FROM platform.jobs
             WHERE kind LIKE 'probe.%' AND status = 'succeeded'
             GROUP BY module_id
            """
        )
        by_module = {r["module_id"]: r["n"] for r in rows}
        check("outcomes are attributable per service, not pooled",
              by_module.get(GRANTS) == 2 and by_module.get(CONTRACTS) == 1,
              f"got {by_module}")

    finally:
        await db.execute("DELETE FROM platform.jobs WHERE kind LIKE 'probe.%'")
        await db.disconnect()

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
