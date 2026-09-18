#!/usr/bin/env python3
"""Verify a database matches what the migrations intended.

Applying without errors is not the same as landing correctly — a managed
Postgres may silently differ on roles, extensions or row-level security. RLS in
particular is the control that keeps one tenant's contracts away from another,
so it is checked explicitly rather than assumed.

Usage:
    python scripts/verify_schema.py                # local
    python scripts/verify_schema.py --production   # hosted

**The default target is local, and the host is always printed.** This script
used to read ``.env.production.local`` unconditionally and announce nothing, so
it reported on production while appearing to describe the laptop. Read-only, so
nothing broke — but it is the same defect as D21 and the reason its "1
unapplied" was right when local was fully migrated.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dsn import resolve_dsn  # noqa: E402

EXPECTED_PLATFORM = {
    "ai_usage",
    "billing_events",
    "email_verifications",
    "entitlements",
    "memberships",
    "model_pricing",
    "modules",
    "plan_limits",
    "plans",
    "platform_config",
    "prompt_registry",
    "schema_migrations",
    "subscriptions",
    "tenants",
    "user_credentials",
    "user_identities",
    "user_sessions",
    "users",
}
EXPECTED_CC = {"ai_usage", "audit_log", "contracts", "documents", "obligations"}


def _args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--production",
        action="store_true",
        help="verify the hosted database instead of the local one",
    )
    return p.parse_args()


async def main() -> int:
    import asyncpg

    dsn = resolve_dsn(production=_args().production)
    conn = await asyncpg.connect(dsn, timeout=30)
    passed = failed = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
            print(f"  PASS  {label}")
        else:
            failed += 1
            print(f"  FAIL  {label} {detail}")

    try:
        print("\nSchema verification\n")

        for schema, expected in (
            ("platform", EXPECTED_PLATFORM),
            ("contract_compliance", EXPECTED_CC),
        ):
            rows = await conn.fetch(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
                schema,
            )
            found = {r["table_name"] for r in rows}
            missing = expected - found
            check(f"{schema}: {len(expected)} tables present", not missing, f"missing {missing}")

        # RLS is the tenant-isolation boundary. FORCE matters because without
        # it the table owner bypasses the policy entirely.
        rls = await conn.fetch(
            """
            SELECT relname, relrowsecurity, relforcerowsecurity
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'contract_compliance' AND c.relkind = 'r'
            """
        )
        unforced = [
            r["relname"]
            for r in rls
            if not (r["relrowsecurity"] and r["relforcerowsecurity"])
        ]
        check(
            "contract_compliance: RLS enabled AND forced on every table",
            not unforced,
            f"{unforced}",
        )

        policies = await conn.fetchval(
            "SELECT count(*) FROM pg_policies WHERE schemaname = 'contract_compliance'"
        )
        check(f"contract_compliance: {policies} RLS policies defined", policies >= len(EXPECTED_CC))

        # Schema-agnostic, and deliberately so. The check above names
        # contract_compliance explicitly, which is why eight tenant-scoped
        # tables in the platform schema -- org_profiles and
        # opportunity_matches among them -- sat with no RLS at all and no
        # build ever said a word. A rule that only inspects the schema
        # somebody remembered to list is not a rule.
        #
        # The invariant: a tenant_id column means the table holds one tenant's
        # data, so it must have RLS enabled, forced, and a policy. Any new
        # table anywhere is covered the moment it is created.
        unprotected = await conn.fetch(
            """
            SELECT n.nspname || '.' || c.relname AS name
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind = 'r'
               AND n.nspname IN ('platform', 'contract_compliance')
               AND EXISTS (
                   SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = n.nspname
                      AND col.table_name  = c.relname
                      AND col.column_name = 'tenant_id'
               )
               AND NOT (
                   c.relrowsecurity
                   AND c.relforcerowsecurity
                   AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
               )
             ORDER BY 1
            """
        )
        check(
            "every tenant-scoped table has RLS enabled, forced, and a policy",
            not unprotected,
            f"{[r['name'] for r in unprotected]}",
        )

        role = await conn.fetchval("SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app'")
        check("zeus_app role exists", role == 1)

        # The app connects as zeus_app precisely so it cannot bypass RLS.
        superuser = await conn.fetchval(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = 'zeus_app'"
        )
        check("zeus_app cannot bypass RLS", superuser is False)

        plans = await conn.fetchval("SELECT count(*) FROM platform.plans")
        check(f"plans seeded ({plans} rows)", plans > 0)

        modules = await conn.fetchval("SELECT count(*) FROM platform.modules")
        check(f"modules seeded ({modules} rows)", modules == 3)

        applied = await conn.fetchval("SELECT count(*) FROM platform.schema_migrations")
        # Compare against the files on disk rather than a hard-coded number, so
        # adding a migration does not silently invalidate this check.
        root = Path(__file__).resolve().parent.parent
        on_disk = sum(
            len(list((root / d).glob("*.sql")))
            for d in (
                "services/platform-core/migrations",
                "services/contract-compliance/migrations",
            )
        )
        check(
            f"migration ledger matches disk ({applied}/{on_disk})",
            applied == on_disk,
            f"{on_disk - applied} unapplied",
        )

        print(f"\n{passed} passed, {failed} failed\n")
        return 1 if failed else 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
