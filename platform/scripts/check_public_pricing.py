"""Assert the public price list matches the database.

The marketing page carries hardcoded prices because it is served to anonymous
visitors and `/billing/plans` requires a tenant. Hardcoded prices drift, and
this particular drift means quoting one number and charging another -- the
landing page previously advertised a $99 "Growth" tier that matched no plan in
the catalogue at all.

So the copy is allowed to be static, but not allowed to be wrong: this reads
the plan ids and dollar amounts out of the TSX and checks each one against
`platform.plans`.

Usage::

    .venv/bin/python scripts/check_public_pricing.py
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from zeus_platform_core.container import Container

LANDING = (
    Path(__file__).resolve().parent.parent
    / "apps/console/src/components/site/LandingPage.tsx"
)
CATALOGUE = Path(__file__).resolve().parent.parent / "apps/console/src/lib/modules.ts"

#: Matches one tier object, e.g. `plan: "gi_growth", ... price: 99,`.
TIER = re.compile(r'plan:\s*"(?P<plan>\w+)".*?price:\s*(?P<price>\d+)', re.DOTALL)
#: Matches a catalogue entry's id and its advertised "from" price.
FROM_PRICE = re.compile(
    r'id:\s*"(?P<module>\w+)".*?startingPrice:\s*(?P<price>\d+)', re.DOTALL
)


async def main() -> int:
    tiers = [(m["plan"], int(m["price"])) for m in TIER.finditer(LANDING.read_text())]
    starting = [
        (m["module"], int(m["price"])) for m in FROM_PRICE.finditer(CATALOGUE.read_text())
    ]
    if not tiers:
        print("FAIL  no priced tiers found in LandingPage.tsx -- has the shape changed?")
        return 1

    container = Container()
    await container.startup()
    try:
        rows = await container.db.fetch(
            "SELECT id, module_id, monthly_cents, is_active FROM platform.plans"
        )
    finally:
        await container.shutdown()

    plans = {r["id"]: r for r in rows}
    failures = 0

    print("advertised tiers")
    for plan_id, dollars in tiers:
        plan = plans.get(plan_id)
        if plan is None:
            print(f"  FAIL  {plan_id}: advertised but not in platform.plans")
            failures += 1
            continue
        if not plan["is_active"]:
            print(f"  FAIL  {plan_id}: advertised but not active")
            failures += 1
            continue
        actual = (plan["monthly_cents"] or 0) / 100
        if actual != dollars:
            print(f"  FAIL  {plan_id}: page says ${dollars}, database says ${actual:g}")
            failures += 1
        else:
            print(f"  PASS  {plan_id} ${dollars}")

    # The "from $X" on each service card must be the cheapest active plan for
    # that service, or the card undersells or oversells the entry point.
    print("\n'from' prices")
    for module_id, dollars in starting:
        live = [
            (p["monthly_cents"] or 0) / 100
            for p in rows
            if p["module_id"] == module_id and p["is_active"] and p["monthly_cents"]
        ]
        if not live:
            print(f"  SKIP  {module_id}: no priced plans")
            continue
        cheapest = min(live)
        if cheapest != dollars:
            print(f"  FAIL  {module_id}: card says from ${dollars}, cheapest is ${cheapest:g}")
            failures += 1
        else:
            print(f"  PASS  {module_id} from ${dollars}")

    print(f"\n{failures} mismatch(es)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
