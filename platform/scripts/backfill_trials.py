#!/usr/bin/env python3
"""Give existing tenants the trials that TRIAL_PLANS now grants at signup.

Changing the signup path only helps accounts created after the change. Every
tenant that already existed was left holding Contract Compliance alone, so
Grant Intelligence shipped invisible to exactly the people already using the
product.

Goes through the container's own repositories and services rather than raw
SQL, so this does exactly what signup does -- including the entitlements
refresh, which is a service and not a database function. Hand-written SQL here
would be a second implementation of the same rule, free to drift.

Additive only: an existing subscription for a module is left alone, so a
paying customer can never be reset to a trial and the script is safe to re-run.

    .venv/bin/python scripts/backfill_trials.py --dry-run
    .venv/bin/python scripts/backfill_trials.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"


def _load_env() -> None:
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


async def main() -> int:
    _load_env()
    sys.path[:0] = [
        str(ROOT / p)
        for p in (
            "packages/config/src",
            "packages/adapters/src",
            "packages/service-kit/src",
            "services/platform-core/src",
        )
    ]

    from zeus_platform_core.container import Container
    from zeus_platform_core.domain.models import SubscriptionStatus
    from zeus_platform_core.services.auth_service import TRIAL_PLANS

    dry_run = "--dry-run" in sys.argv
    container = Container()
    db = container.db
    await db.connect()

    try:
        tenants = await db.fetch("SELECT id, name FROM platform.tenants ORDER BY name")
        touched: list[str] = []

        for tenant in tenants:
            tenant_id = str(tenant["id"])
            existing = {
                s.module_id for s in await container.subscriptions.list_by_tenant(tenant_id)
            }
            missing = [(m, p) for m, p in TRIAL_PLANS if m not in existing]
            if not missing:
                continue

            for module_id, plan_id in missing:
                verb = "WOULD ADD" if dry_run else "adding   "
                print(f"  {verb}  {tenant['name']:<28} {module_id} ({plan_id})")
                if dry_run:
                    continue
                await container.subscriptions.upsert(
                    tenant_id=tenant_id,
                    module_id=module_id,
                    plan_id=plan_id,
                    status=SubscriptionStatus.trialing,
                    stripe_subscription_id=None,
                )

            if not dry_run:
                # Entitlements are a computed read of subscriptions; without
                # this the console keeps serving the old access.
                await container.entitlements.refresh(tenant_id)
            touched.append(str(tenant["name"]))

        print(f"\n{len(touched)} tenant(s) {'to update' if dry_run else 'updated'}")
        return 0
    finally:
        await db.disconnect()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
