"""Verify Phase 5b catalogue SQL against a real Postgres, as ``zeus_app``.

The unit tests run against a fake database. A fake database will happily accept
SQL that does not parse, columns that do not exist, and grants the application
role does not have -- which is to say it cannot fail in any of the ways that
matter. This runs the real statements, as the non-superuser role production
uses, against a throwaway plan and a throwaway model price.

Everything it creates is deleted before it exits, and it touches no existing
row: the plan id and model name are uuid-suffixed so a collision is not
possible.

Usage (from platform/):
    unset PYTHONPATH && PYTHONPATH=... .venv/bin/python scripts/probe_phase5_catalog.py
    ZEUS_PROBE_DSN=postgresql://... .venv/bin/python scripts/probe_phase5_catalog.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import Decimal

from zeus_adapters.db.postgres_db import PostgresDatabase
from zeus_platform_core.repositories.plans import (
    EDITABLE_PLAN_COLUMNS,
    ModelPricingRepository,
    PlanRepository,
)

DEFAULT_DSN = "postgresql://zeus_app:zeus_app@localhost:5433/zeus"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((bool(ok), label))
    print(f"{'  ok  ' if ok else ' FAIL '} {label}")


async def main() -> int:
    dsn = os.environ.get("ZEUS_PROBE_DSN", DEFAULT_DSN)
    db = PostgresDatabase(dsn=dsn)
    await db.connect()

    plans = PlanRepository(db)
    prices = ModelPricingRepository(db)

    suffix = uuid.uuid4().hex[:8]
    plan_id = f"probe_{suffix}"
    model = f"probe-model-{suffix}"

    try:
        # --- the catalogue reads parse and return the shape the router expects
        modules = await plans.list_modules()
        check(bool(modules), f"list_modules returned {len(modules)} module(s)")
        check(
            all({"id", "name"} <= set(m) for m in modules),
            "every module row has id and name",
        )
        module_id = modules[0]["id"]

        all_plans = await plans.list_all()
        check(bool(all_plans), f"list_all returned {len(all_plans)} plan(s)")
        expected = {
            "plan_id",
            "module_id",
            "name",
            "monthly_cents",
            "annual_cents",
            "stripe_price_id_monthly",
            "stripe_price_id_annual",
            "is_active",
            "limits",
            "subscriber_count",
        }
        check(
            expected <= set(all_plans[0]),
            "plan rows carry every column the admin screen reads",
        )
        check(
            isinstance(all_plans[0]["limits"], dict),
            "limits decode to a dict, not the raw jsonb string",
        )
        # The aggregate is the risky part: a LEFT JOIN onto plan_limits without
        # a GROUP BY would multiply plans by their limits and nobody would
        # notice until a plan with two limits appeared twice on screen.
        ids = [p["plan_id"] for p in all_plans]
        check(len(ids) == len(set(ids)), "the limits join does not duplicate plans")

        # --- create ----------------------------------------------------------
        created = await plans.create(
            plan_id=plan_id,
            module_id=module_id,
            name="Probe Plan",
            monthly_cents=1234,
            annual_cents=None,
            stripe_price_id_monthly=None,
            stripe_price_id_annual=None,
            is_active=False,
        )
        check(created is not None, "create inserted the plan")
        again = await plans.create(
            plan_id=plan_id,
            module_id=module_id,
            name="Collision",
            monthly_cents=1,
            annual_cents=None,
            stripe_price_id_monthly=None,
            stripe_price_id_annual=None,
            is_active=False,
        )
        check(again is None, "create on a taken id returns None rather than overwriting")
        fetched = await plans.get(plan_id)
        check(fetched is not None and fetched["name"] == "Probe Plan", "get reads it back")
        check(
            fetched is not None and fetched["subscriber_count"] == 0,
            "a new plan has no subscribers",
        )

        # --- update ----------------------------------------------------------
        changed = await plans.update(plan_id, {"name": "Renamed", "monthly_cents": 4321})
        check(
            changed is not None
            and changed["before"]["name"] == "Probe Plan"
            and changed["after"]["name"] == "Renamed",
            "update returns the row before and after",
        )
        # Every editable column is exercised, because the SET clause is built by
        # string interpolation from this set: a name here that is not a real
        # column would be a syntax error only at runtime, on the one edit
        # nobody tested.
        ok = True
        for column in sorted(EDITABLE_PLAN_COLUMNS):
            value = {
                "name": "Renamed",
                "monthly_cents": 1,
                "annual_cents": 1,
                "stripe_price_id_monthly": None,
                "stripe_price_id_annual": None,
                "is_active": False,
            }[column]
            if await plans.update(plan_id, {column: value}) is None:
                ok = False
        check(ok, "every column in EDITABLE_PLAN_COLUMNS really exists and is writable")

        rejected = False
        try:
            await plans.update(plan_id, {"module_id": "hijack"})
        except ValueError:
            rejected = True
        check(rejected, "update refuses a column outside the frozen set")
        check(
            await plans.update(f"missing_{suffix}", {"name": "x"}) is None,
            "update of a missing plan is None",
        )

        # --- limits ----------------------------------------------------------
        await plans.set_limits(plan_id, {"seats": 5, "scans_per_month": None})
        after = await plans.get(plan_id)
        check(
            after is not None and after["limits"].get("seats") == 5,
            "set_limits wrote an integer limit",
        )
        check(
            after is not None
            and "scans_per_month" in after["limits"]
            and after["limits"]["scans_per_month"] is None,
            "a null limit is stored and read back as null, meaning unlimited",
        )

        await plans.set_limits(plan_id, {"seats": 9})
        after = await plans.get(plan_id)
        check(
            after is not None and after["limits"] == {"seats": 9},
            "set_limits replaces the whole set rather than merging",
        )

        # --- model prices -----------------------------------------------------
        result = await prices.upsert(
            model=model,
            input_per_million_usd=Decimal("0.2500"),
            output_per_million_usd=Decimal("2.0000"),
            updated_by=None,
        )
        check(result["previous"] is None, "a first write reports no previous price")
        second = await prices.upsert(
            model=model,
            input_per_million_usd=Decimal("9.0000"),
            output_per_million_usd=Decimal("1.0000"),
            updated_by=None,
        )
        check(
            second["previous"] is not None
            and Decimal(str(second["previous"]["input_per_million_usd"])) == Decimal("0.2500"),
            "an overwrite reports what the price was, so the audit says what changed",
        )
        check(
            Decimal(str(second["input_per_million_usd"])) == Decimal("9.0000"),
            "the new price is what comes back",
        )

        listed = await prices.list_all()
        row = next((r for r in listed if r["model"] == model), None)
        check(row is not None, "list_all includes the new price")
        check(
            row is not None and {"call_count", "total_cost_usd", "updated_by_email"} <= set(row),
            "list_all carries the usage columns the screen reads",
        )
        check(
            row is not None and row["call_count"] == 0,
            "an unused model reports zero calls rather than null",
        )

        unpriced = await prices.unpriced_models()
        check(
            all(u["model"] != model for u in unpriced),
            "a priced model is not reported as unpriced",
        )
        check(
            all({"model", "call_count", "last_used_at"} <= set(u) for u in unpriced),
            f"unpriced_models parses and returned {len(unpriced)} row(s)",
        )

        removed = await prices.delete(model)
        check(removed is not None, "delete returns the row it removed")
        check(await prices.get(model) is None, "the price is gone")
        check(await prices.delete(model) is None, "deleting twice is None, not an error")

        return 0 if all(ok for ok, _ in results) else 1
    finally:
        # Ordered so the foreign key from plan_limits is satisfied.
        await db.execute("DELETE FROM platform.plan_limits WHERE plan_id = $1", plan_id)
        await db.execute("DELETE FROM platform.plans WHERE id = $1", plan_id)
        await db.execute("DELETE FROM platform.model_pricing WHERE model = $1", model)
        await db.disconnect()


if __name__ == "__main__":
    code = asyncio.run(main())
    passed = sum(1 for ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    sys.exit(code)
