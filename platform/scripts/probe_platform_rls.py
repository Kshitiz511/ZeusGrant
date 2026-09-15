#!/usr/bin/env python3
"""Does RLS on the platform schema break platform-level work?

RLS on a tenant-scoped table filters on ``app.current_tenant``. When nothing
is bound that setting is NULL, ``tenant_id = NULL`` is NULL, and the row is
filtered out. Plenty of legitimate work runs with no tenant bound -- signup,
entitlement refresh, billing webhooks, the worker claiming a job -- so the
question is not whether the policies exist but whether they quietly turn those
paths into no-ops.

Silent is the danger. None of these raise; they just return nothing.

Run against the LOCAL database only.

    ZEUS_DATABASE_URL=postgresql://zeus:zeus@localhost:5433/zeus \
      .venv/bin/python scripts/probe_platform_rls.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DSN = os.environ.get(
    "ZEUS_DATABASE_URL", "postgresql://zeus:zeus@localhost:5433/zeus"
)

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'  ' + detail if detail else ''}")


async def main() -> int:
    sys.path[:0] = [
        str(ROOT / p) for p in ("packages/config/src", "packages/adapters/src")
    ]
    import asyncpg

    if "localhost" not in DSN and "127.0.0.1" not in DSN:
        print("Refusing to run against a non-local database.")
        return 1

    conn = await asyncpg.connect(DSN, timeout=30)
    try:
        who = await conn.fetchval("SELECT current_user")
        print(f"\nconnected as {who}\n")

        tenant = uuid.uuid4()
        other = uuid.uuid4()
        owner = uuid.uuid4()

        # Seed as the owner/superuser path, with no tenant bound. If this
        # fails, platform-level writes are already broken.
        await conn.execute(
            "INSERT INTO platform.users (id, email) VALUES ($1, $2)",
            owner,
            f"rls-probe-{owner.hex[:8]}@example.test",
        )
        await conn.execute(
            "INSERT INTO platform.tenants (id, name, slug, owner_user_id) VALUES ($1, $2, $3, $4)",
            tenant,
            "RLS probe",
            f"rls-probe-{tenant.hex[:8]}",
            owner,
        )
        await conn.execute(
            "INSERT INTO platform.tenants (id, name, slug, owner_user_id) VALUES ($1, $2, $3, $4)",
            other,
            "RLS probe other",
            f"rls-other-{other.hex[:8]}",
            owner,
        )
        await conn.execute(
            """
            INSERT INTO platform.subscriptions (tenant_id, module_id, plan_id, status)
            VALUES ($1, 'grant_intelligence', 'gi_starter', 'trialing')
            """,
            tenant,
        )
        check("platform-level write with no tenant bound succeeds", True)

        # The decisive one: can platform-level code still READ what it wrote?
        n = await conn.fetchval(
            "SELECT count(*) FROM platform.subscriptions WHERE tenant_id = $1", tenant
        )
        check(
            "platform-level read with no tenant bound returns rows",
            n == 1,
            f"got {n}, want 1 -- 0 means signup and billing silently break",
        )

        # The membership lookup that decides which tenant may be bound has to
        # run before anything is bound, so it must survive the policy too.
        await conn.execute(
            """
            INSERT INTO platform.memberships (tenant_id, user_id, role)
            VALUES ($1, $2, 'owner')
            """,
            tenant,
            owner,
        )
        seen = await conn.fetchval(
            """
            SELECT count(*) FROM platform.memberships
             WHERE user_id = $1 AND tenant_id = $2
            """,
            owner,
            tenant,
        )
        check(
            "membership lookup works with no tenant bound",
            seen == 1,
            f"got {seen}, want 1 -- 0 locks every user out of every workspace",
        )

        # And the isolation the policies are actually for.
        async with conn.transaction():
            await conn.execute(
                "SELECT set_config('app.current_tenant', $1, true)", str(tenant)
            )
            mine = await conn.fetchval(
                "SELECT count(*) FROM platform.subscriptions WHERE tenant_id = $1", tenant
            )
            theirs = await conn.fetchval(
                "SELECT count(*) FROM platform.subscriptions WHERE tenant_id = $1", other
            )
            # No predicate at all: this is the forgotten-WHERE-clause case the
            # policy exists to contain.
            unfiltered = await conn.fetch(
                "SELECT DISTINCT tenant_id FROM platform.subscriptions"
            )
        check("bound tenant sees its own rows", mine == 1, f"got {mine}")
        check("bound tenant cannot see another tenant's rows", theirs == 0, f"got {theirs}")
        check(
            "a query with no tenant predicate is still confined to one tenant",
            [str(r["tenant_id"]) for r in unfiltered] == [str(tenant)],
            f"saw {len(unfiltered)} distinct tenant(s)",
        )

        await conn.execute("DELETE FROM platform.memberships WHERE tenant_id = $1", tenant)
        await conn.execute("DELETE FROM platform.subscriptions WHERE tenant_id = $1", tenant)
        await conn.execute("DELETE FROM platform.tenants WHERE id = ANY($1)", [tenant, other])
        await conn.execute("DELETE FROM platform.users WHERE id = $1", owner)
    finally:
        await conn.close()

    failed = [r for r in results if not r[0]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
