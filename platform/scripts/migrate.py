#!/usr/bin/env python3
"""Apply SQL migrations to any Postgres, local or hosted.

Mirrors the docker-compose `migrate` service exactly — same ledger table, same
ordering, same one-transaction-per-file guarantee — but connects over a DSN so
it can target Supabase from a laptop or from CI.

Usage:
    uv run --with asyncpg python scripts/migrate.py                # LOCAL
    uv run --with asyncpg python scripts/migrate.py --dry-run      # show pending only
    uv run --with asyncpg python scripts/migrate.py --production   # hosted, asks first
    ZEUS_MIGRATE_URL=... uv run --with asyncpg python scripts/migrate.py

**The default target is local.** It used to be whatever sat in
``.env.production.local``, which meant the shortest command in the file — the
one you type while developing — ran DDL against the live database. That is how
0018 reached production hours before its code did. Reaching production now costs
a flag and a typed confirmation, and the host is echoed before anything runs.

This is the same lesson as D17, which put a local-only guard on the e2e scripts.
The guard was never extended to the one script whose entire purpose is to change
the schema.

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


#: Where migrations go when nobody says otherwise. Matches the docker-compose
#: Postgres the tests and probes use.
LOCAL_DSN = "postgresql://zeus:zeus@localhost:5433/zeus"


def _is_local(dsn: str) -> bool:
    host = dsn.split("@")[-1].split("/")[0]
    return host.startswith(("localhost", "127.0.0.1", "[::1]", "postgres:"))


def resolve_dsn(production: bool) -> str:
    """Pick the target, defaulting to local and never guessing at production.

    An explicit ``ZEUS_MIGRATE_URL`` still wins, because CI sets it and because
    someone who exported a DSN meant it. But it is checked for locality below
    like every other path, so an exported production URL cannot migrate the live
    database just because it happened to be in the shell.
    """
    dsn = os.environ.get("ZEUS_MIGRATE_URL")
    if dsn:
        return dsn
    if not production:
        return LOCAL_DSN
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            if line.startswith("ZEUS_MIGRATE_URL="):
                return line.split("=", 1)[1].strip()
    print("--production given but no ZEUS_MIGRATE_URL in .env.production.local.")
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

    dry_run = "--dry-run" in sys.argv
    production = "--production" in sys.argv
    assume_yes = "--yes" in sys.argv

    dsn = resolve_dsn(production)
    if ":6543" in dsn:
        print("Refusing to migrate through the transaction pooler (:6543).")
        print("Use the session pooler (:5432) — transaction mode cannot run DDL.")
        return 1

    host = dsn.split("@")[-1].split("/")[0]

    # A remote host gets a deliberate stop, even when --production was passed,
    # because the flag says which database and this says yes to changing it.
    # --yes exists for CI, which cannot type, and is the only way past it.
    if not _is_local(dsn) and not dry_run and not assume_yes:
        print(f"\n  This will run DDL against a REMOTE database:\n\n    {host}\n")
        if not sys.stdin.isatty():
            # Nobody is there to answer. Refuse rather than raise EOFError, so
            # the log says why it stopped instead of showing a traceback.
            print("  Not a terminal. Pass --yes to migrate a remote database")
            print("  from CI, where the pull request is the authorisation.")
            return 1
        if input("  Type the host to continue: ").strip() != host:
            print("  Aborted.")
            return 1

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
