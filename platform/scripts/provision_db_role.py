#!/usr/bin/env python3
"""Provision the runtime database role on a hosted Postgres.

The application must NOT connect as the role that owns the tables. Ownership
carries implicit privileges and, before FORCE ROW LEVEL SECURITY was applied,
exempted the owner from tenant isolation policies entirely. Connecting as an
unprivileged `zeus_app` means a mistake in one policy cannot escalate into
cross-tenant access, and it keeps DDL out of reach of the running service.

The migrations create `zeus_app` with a well-known development password. This
script rotates it to a generated secret and prints the runtime DSN to paste
into .env.production.local.

Usage:
    uv run --with asyncpg python scripts/provision_db_role.py
"""

from __future__ import annotations

import asyncio
import secrets
import sys
from pathlib import Path
from urllib.parse import quote

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.production.local"


def load(name: str) -> str:
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    print(f"{name} not found in {ENV_FILE.name}")
    sys.exit(1)


# Schemas the runtime role needs. DDL is deliberately excluded: the service can
# read and write rows but cannot alter the shape of the database.
GRANTS = """
GRANT USAGE ON SCHEMA platform, contract_compliance TO zeus_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA platform, contract_compliance TO zeus_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform, contract_compliance TO zeus_app;

-- Future tables created by later migrations inherit the same grants, so a new
-- migration cannot accidentally leave the app unable to read its own data.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, contract_compliance
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zeus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA platform, contract_compliance
  GRANT USAGE, SELECT ON SEQUENCES TO zeus_app;
"""


async def main() -> int:
    import asyncpg

    admin_dsn = load("ZEUS_MIGRATE_URL")
    password = secrets.token_urlsafe(32)

    conn = await asyncpg.connect(admin_dsn, timeout=30)
    try:
        await conn.execute(
            """
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
                    CREATE ROLE zeus_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
                END IF;
            END $$;
            """
        )
        # Quoted literal rather than a parameter: ALTER ROLE ... PASSWORD does
        # not accept bind parameters. The value is generated here, never user
        # input, so there is nothing to inject.
        await conn.execute(f"ALTER ROLE zeus_app WITH LOGIN PASSWORD '{password}'")
        await conn.execute(GRANTS)

        # Privilege attributes are verified, never altered. Managed Postgres
        # does not grant superuser, so ALTER ROLE ... NOSUPERUSER/NOBYPASSRLS
        # is rejected even for the project owner. The migration creates the
        # role correctly; this asserts nothing has drifted since. A role able
        # to bypass RLS would defeat tenant isolation regardless of how the
        # policies are written, so this is a hard stop rather than a warning.
        row = await conn.fetchrow(
            """
            SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
            FROM pg_roles WHERE rolname = 'zeus_app'
            """
        )
        unsafe = [name for name, value in dict(row).items() if value]
        if unsafe:
            print(f"Refusing to continue: zeus_app has unsafe attributes: {unsafe}")
            print("Recreate it as NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB.")
            return 1

        # Rebuild the runtime DSN from the admin one, swapping in the new role.
        # The Supabase pooler expects the tenant-qualified username form
        # `<role>.<project-ref>`.
        tail = admin_dsn.split("@", 1)[1].replace(":5432/", ":6543/")
        project_ref = admin_dsn.split("//", 1)[1].split(":", 1)[0].split(".", 1)[1]
        runtime_dsn = f"postgresql://zeus_app.{project_ref}:{quote(password, safe='')}@{tail}"

        print("\nzeus_app provisioned (NOSUPERUSER, NOBYPASSRLS, no DDL).")
        print("\nSet this as ZEUS_DATABASE_URL in .env.production.local:\n")
        print(runtime_dsn)
        print()
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
