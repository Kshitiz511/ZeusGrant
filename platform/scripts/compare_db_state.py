#!/usr/bin/env python3
"""Compare the migration ledger and new-table state between local and production.

Written after I ran scripts/migrate.py without realising it targets Supabase by
design -- it reads .env.production.local and has no local mode. This script
answers the only two questions that matter after that mistake: what does each
database actually contain, and do they agree.

Prints no DSNs. Host only, so the output is safe to paste.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import announce, env_value  # noqa: E402

LOCAL_DSN = os.environ.get(
    "ZEUS_LOCAL_URL", "postgresql://zeus:zeus@localhost:5433/zeus"
)

NEW_TABLES = ["opportunities", "org_profiles", "opportunity_matches",
              "eligibility_codes", "jobs"]
NEW_FUNCS = ["scorer_version", "focus_tsquery", "score_opportunities_for_tenant",
             "refresh_matches_for_tenant", "claim_job", "finish_job", "heartbeat_job"]


def prod_dsn() -> str | None:
    dsn = env_value("ZEUS_MIGRATE_URL")
    if dsn:
        announce(dsn, role="owner", purpose="schema comparison")
    return dsn


async def inspect(label: str, dsn: str) -> None:
    print(f"\n=== {label} ===")
    try:
        conn = await asyncpg.connect(dsn, timeout=15)
    except Exception as exc:  # noqa: BLE001 - we want the reason, whatever it is
        print(f"  could not connect: {type(exc).__name__}: {exc}")
        return

    try:
        host = await conn.fetchval("SELECT inet_server_addr()::text")
        print(f"  server: {host or 'local socket'}")

        applied = await conn.fetch(
            "SELECT filename FROM platform.schema_migrations ORDER BY filename"
        )
        names = [r["filename"] for r in applied]
        print(f"  migrations applied: {len(names)}")
        for n in names:
            if any(k in n for k in ("0008", "0009", "0010")):
                print(f"    -> {n}")

        print("  new tables:")
        for t in NEW_TABLES:
            exists = await conn.fetchval(
                "SELECT to_regclass($1) IS NOT NULL", f"platform.{t}"
            )
            count = None
            if exists:
                count = await conn.fetchval(f"SELECT count(*) FROM platform.{t}")
            print(f"    {t:<22} {'yes' if exists else 'MISSING':<8} rows={count}")

        print("  new functions:")
        for f in NEW_FUNCS:
            exists = await conn.fetchval(
                """SELECT EXISTS (
                       SELECT 1 FROM pg_proc p
                       JOIN pg_namespace n ON n.oid = p.pronamespace
                       WHERE n.nspname = 'platform' AND p.proname = $1
                   )""",
                f,
            )
            print(f"    {f:<34} {'yes' if exists else 'MISSING'}")

        # The question behind the question: did anything pre-existing change?
        users = await conn.fetchval("SELECT count(*) FROM platform.users")
        tenants = await conn.fetchval("SELECT count(*) FROM platform.tenants")
        print(f"  pre-existing data intact: users={users} tenants={tenants}")
    finally:
        await conn.close()


async def main() -> None:
    await inspect("LOCAL (expected localhost:5433)", LOCAL_DSN)
    dsn = prod_dsn()
    if dsn:
        await inspect("PRODUCTION (Supabase)", dsn)
    else:
        print("\nNo production DSN found; skipped.", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
