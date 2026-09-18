#!/usr/bin/env python3
"""Prove tenant isolation holds on the hosted database.

This is the check that the local test suite structurally cannot make: locally
the app connects as a non-owner, so RLS appears to work even when it is only
ENABLEd. On a hosted Postgres the migration role owns the tables and carries
BYPASSRLS, so isolation depends on the runtime role being unprivileged *and*
on FORCE ROW LEVEL SECURITY being set.

Writes two tenants' rows, then reads back under each tenant context and
asserts neither can see the other. Cleans up after itself.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import required_dsn  # noqa: E402

TENANT_A = str(uuid.uuid4())
TENANT_B = str(uuid.uuid4())


def load(name: str) -> str:
    # Announced because this script connects as two different roles, and which
    # one is in use decides whether a pass means anything: an owner bypasses
    # RLS and will report isolation working when it is not.
    return required_dsn(name, purpose="tenant isolation check")


async def seed(conn, tenant_id: str, title: str) -> str:
    """Insert one contract under a tenant context and return its id."""
    async with conn.transaction():
        await conn.execute("SELECT set_config('app.current_tenant', $1, true)", tenant_id)
        return await conn.fetchval(
            """
            INSERT INTO contract_compliance.contracts (tenant_id, title, status)
            VALUES ($1::uuid, $2, 'draft')
            RETURNING id
            """,
            tenant_id,
            title,
        )


async def visible(conn, tenant_id: str) -> set[str]:
    async with conn.transaction():
        await conn.execute("SELECT set_config('app.current_tenant', $1, true)", tenant_id)
        rows = await conn.fetch("SELECT id FROM contract_compliance.contracts")
        return {str(r["id"]) for r in rows}


async def main() -> int:
    import asyncpg

    runtime_dsn = load("ZEUS_DATABASE_URL")
    admin_dsn = load("ZEUS_MIGRATE_URL")

    if "zeus_app" not in runtime_dsn:
        print("ZEUS_DATABASE_URL does not use the zeus_app role.")
        print("Connecting as the table owner would bypass RLS entirely.")
        return 1

    conn = await asyncpg.connect(runtime_dsn, statement_cache_size=0, timeout=30)
    passed = failed = 0

    def check(label: str, ok: bool, detail: str = "") -> None:
        nonlocal passed, failed
        if ok:
            passed += 1
            print(f"  PASS  {label}")
        else:
            failed += 1
            print(f"  FAIL  {label} {detail}")

    a_id = b_id = None
    try:
        print("\nTenant isolation on hosted Postgres\n")

        who = await conn.fetchval("SELECT current_user")
        check(f"app connects as unprivileged role ({who})", who == "zeus_app")

        bypass = await conn.fetchval(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"
        )
        check("runtime role cannot bypass RLS", bypass is False)

        a_id = await seed(conn, TENANT_A, "Tenant A contract")
        b_id = await seed(conn, TENANT_B, "Tenant B contract")
        check("seeded one contract per tenant", a_id is not None and b_id is not None)

        a_sees = await visible(conn, TENANT_A)
        b_sees = await visible(conn, TENANT_B)

        check("tenant A sees its own contract", str(a_id) in a_sees)
        check("tenant A cannot see tenant B's", str(b_id) not in a_sees)
        check("tenant B sees its own contract", str(b_id) in b_sees)
        check("tenant B cannot see tenant A's", str(a_id) not in b_sees)
        check(f"each tenant sees exactly 1 row (A={len(a_sees)}, B={len(b_sees)})",
              len(a_sees) == 1 and len(b_sees) == 1)

        # A query that forgets to bind a tenant must not return everything.
        # Two distinct safe outcomes are possible, depending on whether this
        # connection has ever had the setting bound:
        #   * never bound   -> current_setting(...) is NULL, NULL::uuid is NULL,
        #                      `tenant_id = NULL` is never true -> 0 rows.
        #   * previously bound -> the local setting resets to '' rather than
        #                      disappearing, and ''::uuid raises.
        # Both fail closed. The second is louder, which on a pooled connection
        # is the better of the two: a missing tenant binding surfaces as an
        # error instead of a silently empty result that looks like "no data".
        try:
            leaked = await conn.fetch("SELECT id FROM contract_compliance.contracts")
            check("no tenant context returns 0 rows (fails closed)", len(leaked) == 0,
                  f"leaked {len(leaked)}")
        except asyncpg.exceptions.InvalidTextRepresentationError:
            check("no tenant context raises rather than leaking (fails closed)", True)

        print(f"\n{passed} passed, {failed} failed\n")
        return 1 if failed else 0
    finally:
        await conn.close()
        # Clean up as the owner, which can see across tenants.
        admin = await asyncpg.connect(admin_dsn, timeout=30)
        try:
            await admin.execute(
                "DELETE FROM contract_compliance.contracts WHERE tenant_id = ANY($1::uuid[])",
                [TENANT_A, TENANT_B],
            )
        finally:
            await admin.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
