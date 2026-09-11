#!/usr/bin/env python3
"""Apply SQL migrations to any Postgres, local or hosted.

Mirrors the docker-compose `migrate` service exactly — same ledger table, same
ordering, same one-transaction-per-file guarantee — but connects over a DSN so
it can target Supabase from a laptop or from CI.

Usage:
    uv run --with asyncpg python scripts/migrate.py                # .env.production.local
    uv run --with asyncpg python scripts/migrate.py --dry-run      # show pending only
    ZEUS_MIGRATE_URL=... uv run --with asyncpg python scripts/migrate.py

Always connects with the SESSION pooler (:5432). Transaction-mode pooling
cannot run DDL reliably, and a half-applied migration is far more expensive
than a slow one.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"

# Directory prefixes encode cross-service ordering: the platform schema must
# exist before any module schema references it.
MIGRATION_DIRS = [
    ("00-platform-core", ROOT / "services" / "platform-core" / "migrations"),
    ("10-contract-compliance", ROOT / "services" / "contract-compliance" / "migrations"),
]

LEDGER_DDL = """
CREATE SCHEMA IF NOT EXISTS platform;
CREATE TABLE IF NOT EXISTS platform.schema_migrations (
    filename    text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
"""


def resolve_dsn() -> str:
    dsn = os.environ.get("ZEUS_MIGRATE_URL")
    if dsn:
        return dsn
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith("ZEUS_MIGRATE_URL="):
                return line.split("=", 1)[1].strip()
    print("No ZEUS_MIGRATE_URL in the environment or .env.production.local.")
    sys.exit(1)


def discover() -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    for prefix, directory in MIGRATION_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.sql")):
            found.append((f"{prefix}/{path.name}", path))
    return found


async def main() -> int:
    import asyncpg

    dsn = resolve_dsn()
    if ":6543" in dsn:
        print("Refusing to migrate through the transaction pooler (:6543).")
        print("Use the session pooler (:5432) — transaction mode cannot run DDL.")
        return 1

    dry_run = "--dry-run" in sys.argv
    host = dsn.split("@")[-1].split("/")[0]
    print(f"\nMigrating {host}{' (dry run)' if dry_run else ''}\n")

    conn = await asyncpg.connect(dsn, timeout=30)
    try:
        if not dry_run:
            await conn.execute(LEDGER_DDL)
        elif not await conn.fetchval("SELECT to_regclass('platform.schema_migrations')"):
            print("  (ledger table does not exist yet; every migration is pending)\n")

        applied: set[str] = set()
        if await conn.fetchval("SELECT to_regclass('platform.schema_migrations')"):
            rows = await conn.fetch("SELECT filename FROM platform.schema_migrations")
            applied = {r["filename"] for r in rows}

        pending = 0
        for name, path in discover():
            if name in applied:
                print(f"  skipping  {name}")
                continue
            pending += 1
            if dry_run:
                print(f"  PENDING   {name}")
                continue
            print(f"  applying  {name}")
            sql = path.read_text()
            # One transaction per file: it lands completely or not at all, and
            # the ledger row commits with it so a crash cannot desynchronise
            # the two.
            async with conn.transaction():
                await conn.execute(sql)
                await conn.execute(
                    "INSERT INTO platform.schema_migrations (filename) VALUES ($1)", name
                )

        print(f"\n{pending} pending, {len(applied)} already applied")
        if not dry_run:
            print("migrations up to date")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
