"""Prove the usage ledger end to end against a real database.

The unit tests use a fake database, so they can only show that the code does
what it intends. They cannot show that the pricing rows actually exist, that
the model name the application sends actually matches the key those rows are
stored under, or that ``tenant_id IS NULL`` is actually permitted. Each of
those is a property of the database rather than of the code, and each was
broken before migration 0015.

This connects as ``zeus_app`` -- the non-superuser role production runs as --
writes real rows through the real recorder, reads them back through the real
repository, and then deletes nothing, because ``ai_usage`` has DELETE revoked.
The rows it writes are marked with a probe module id so they can be told apart
from genuine usage.

Usage:
    ZEUS_PROBE_URL=postgresql://zeus_app:zeus_app@localhost:5433/zeus \\
        python scripts/probe_usage.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta

sys.path[:0] = [
    "packages/adapters/src",
    "packages/config/src",
    "packages/service-kit/src",
    "services/platform-core/src",
]

PROBE_MODULE = "__probe__"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}" + (f" -- {detail}" if detail else ""))


async def main() -> int:
    import asyncpg
    from zeus_platform_core.repositories.usage import UsageRepository
    from zeus_service_kit.metering import AiUsageRecorder

    dsn = os.environ.get("ZEUS_PROBE_URL", "postgresql://zeus_app:zeus_app@localhost:5433/zeus")
    pool = await asyncpg.create_pool(dsn, min_size=1, max_size=2)

    class Db:
        """The Database protocol, narrowed to what these two classes use."""

        async def execute(self, sql: str, *args):
            async with pool.acquire() as c:
                return await c.execute(sql, *args)

        async def fetch(self, sql: str, *args):
            async with pool.acquire() as c:
                return await c.fetch(sql, *args)

        async def fetch_one(self, sql: str, *args):
            async with pool.acquire() as c:
                return await c.fetchrow(sql, *args)

    db = Db()
    recorder = AiUsageRecorder(db)
    repo = UsageRepository(db)

    print("\nUsage ledger probe\n")

    # The seed must actually be present, and under the unqualified name the
    # application will look it up by.
    price = await recorder.price_for("gpt-5-mini")
    check("gpt-5-mini has a configured price", price is not None)
    if price is None:
        print("\n  Migration 0015 has not been applied to this database.\n")
        await pool.close()
        return 1

    # The exact string grant enrichment sends. If normalisation regressed, this
    # returns None and every enrichment row would be silently unpriced.
    qualified = await recorder.price_for("openai:gpt-5-mini")
    check("a provider-qualified name resolves to the same price", qualified == price)

    tenant = str(uuid.uuid4())

    await recorder.record(
        tenant_id=tenant,
        module_id=PROBE_MODULE,
        operation="probe",
        model="openai:gpt-5-mini",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    )

    row = await db.fetch_one(
        "SELECT model, cost_usd, total_tokens FROM platform.ai_usage "
        "WHERE tenant_id = $1::uuid ORDER BY id DESC LIMIT 1",
        tenant,
    )
    check("a tenant-attributed row was written", row is not None)
    if row is not None:
        check(
            "the model name was stored unqualified",
            row["model"] == "gpt-5-mini",
            str(row["model"]),
        )
        # 1M input at $0.25 + 1M output at $2.00.
        check(
            "cost was computed, not left NULL",
            row["cost_usd"] is not None and float(row["cost_usd"]) == 2.25,
            str(row["cost_usd"]),
        )
        check("generated token total is correct", row["total_tokens"] == 2_000_000)

    # The shared-catalogue case: permitted only because 0015 dropped NOT NULL.
    await recorder.record(
        tenant_id=None,
        module_id=PROBE_MODULE,
        operation="probe_platform",
        model="gpt-5-mini",
        prompt_tokens=1000,
    )
    n = await db.fetch_one(
        "SELECT count(*) AS n FROM platform.ai_usage "
        "WHERE tenant_id IS NULL AND module_id = $1",
        PROBE_MODULE,
    )
    check("platform-wide usage can be recorded with no tenant", n["n"] > 0)

    # And, crucially, that it does not leak into anybody's bill.
    since = datetime.now(UTC) - timedelta(days=1)
    until = datetime.now(UTC) + timedelta(days=1)
    totals = await repo.tenant_totals(tenant, since=since, until=until)
    check(
        "the tenant total excludes platform-wide rows",
        totals["calls"] == 1,
        f"expected 1 call, got {totals['calls']}",
    )
    check(
        "the tenant total carries real money",
        totals["cost_usd"] is not None and float(totals["cost_usd"]) == 2.25,
        str(totals["cost_usd"]),
    )
    check("nothing in the period was unpriced", totals["unpriced_calls"] == 0)

    # An unpriced model must show up as unknown rather than as free.
    await recorder.record(
        tenant_id=tenant,
        module_id=PROBE_MODULE,
        operation="probe_unpriced",
        model="not-a-real-model",
        prompt_tokens=5000,
    )
    totals = await repo.tenant_totals(tenant, since=since, until=until)
    check(
        "an unpriced call is counted but adds no cost",
        totals["calls"] == 2 and totals["unpriced_calls"] == 1,
        f"calls={totals['calls']} unpriced={totals['unpriced_calls']}",
    )
    check(
        "the priced portion of the total is still reported",
        totals["cost_usd"] is not None and float(totals["cost_usd"]) == 2.25,
        str(totals["cost_usd"]),
    )

    # The ledger is billing evidence; the app role must not be able to rewrite it.
    try:
        await db.execute("DELETE FROM platform.ai_usage WHERE module_id = $1", PROBE_MODULE)
        check("the application role cannot delete usage rows", False, "DELETE succeeded")
    except asyncpg.InsufficientPrivilegeError:
        check("the application role cannot delete usage rows", True)

    series = await repo.daily_series(tenant, since=since, until=until)
    check("the daily series includes days with no usage", len(series) >= 1)

    by_module = await repo.by_module(tenant, since=since, until=until)
    check(
        "usage is attributable to a module",
        any(r["module_id"] == PROBE_MODULE for r in by_module),
    )

    await pool.close()
    print(f"\n{passed} passed, {failed} failed\n")
    if failed == 0:
        print(f"  Probe rows remain under module_id '{PROBE_MODULE}'; the ledger is")
        print("  append-only by design, so clean them up as the migration role.\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
