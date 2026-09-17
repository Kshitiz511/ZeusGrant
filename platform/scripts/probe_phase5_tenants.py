"""Verify Phase 5a tenant control against a real Postgres, as ``zeus_app``.

The unit tests run against a fake database, which cannot tell you whether the
SQL parses, whether the grants are right, or whether RLS lets an admin request
see across tenants. Those are exactly the things that only fail in production.
This connects as the non-superuser role the application actually uses and
exercises the real statements.

Usage (from platform/):
    unset PYTHONPATH && PYTHONPATH=... .venv/bin/python scripts/probe_phase5_tenants.py
    ZEUS_PROBE_DSN=postgresql://... .venv/bin/python scripts/probe_phase5_tenants.py

Defaults to the local Docker Postgres. Point ZEUS_PROBE_DSN at production to
verify a deploy. Everything it creates is rolled back or deleted at the end;
it makes no lasting change.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid

from zeus_adapters.db.postgres_db import PostgresDatabase
from zeus_adapters.db.tenant_context import tenant_scope

DEFAULT_DSN = "postgresql://zeus_app:zeus_app@localhost:5433/zeus"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str) -> None:
    results.append((bool(ok), label))
    print(f"{'  ok  ' if ok else ' FAIL '} {label}")


async def main() -> int:
    dsn = os.environ.get("ZEUS_PROBE_DSN", DEFAULT_DSN)
    db = PostgresDatabase(dsn=dsn)
    await db.connect()

    tenant_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())

    try:
        # Fixtures. A throwaway tenant, so nothing here can disturb real data.
        await db.execute(
            "INSERT INTO platform.users (id, email) VALUES ($1, $2)",
            user_id,
            f"probe-{user_id[:8]}@example.invalid",
        )
        await db.execute(
            """
            INSERT INTO platform.tenants (id, name, slug, owner_user_id)
            VALUES ($1, 'Probe Tenant', $2, $3)
            """,
            tenant_id,
            f"probe-{tenant_id[:8]}",
            user_id,
        )

        # --- the table exists with the shape the code assumes ---------------
        cols = await db.fetch(
            """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'platform' AND table_name = 'tenant_limit_overrides'
            """
        )
        by_name = {c["column_name"]: c["is_nullable"] for c in cols}
        check(
            set(by_name)
            == {
                "tenant_id",
                "limit_key",
                "limit_value",
                "reason",
                "set_by",
                "created_at",
                "updated_at",
            },
            "tenant_limit_overrides has exactly the expected columns",
        )
        check(by_name.get("limit_value") == "YES", "limit_value is nullable (= unlimited)")
        check(by_name.get("reason") == "NO", "reason is NOT NULL, so it cannot be skipped")

        # --- status column and its index ------------------------------------
        idx = await db.fetch_one(
            "SELECT indexdef FROM pg_indexes "
            "WHERE schemaname='platform' AND indexname='tenants_status_idx'"
        )
        check(idx is not None, "tenants_status_idx exists")
        check(
            idx is not None and "status <> 'active'" in idx["indexdef"],
            "tenants_status_idx is partial, so it stays small as tenants grow",
        )

        # --- RLS is on and forced -------------------------------------------
        rls = await db.fetch_one(
            """
            SELECT relrowsecurity, relforcerowsecurity
            FROM pg_class WHERE oid = 'platform.tenant_limit_overrides'::regclass
            """
        )
        check(bool(rls and rls["relrowsecurity"]), "row level security is enabled")
        check(
            bool(rls and rls["relforcerowsecurity"]),
            "row level security is FORCED, so the owner cannot bypass it either",
        )

        # --- the real statements run -----------------------------------------
        await db.execute(
            """
            INSERT INTO platform.tenant_limit_overrides
                   (tenant_id, limit_key, limit_value, reason, set_by)
            VALUES ($1, 'probe_key', 500, 'probe', $2)
            ON CONFLICT (tenant_id, limit_key) DO UPDATE
               SET limit_value = EXCLUDED.limit_value, updated_at = now()
            """,
            tenant_id,
            user_id,
        )
        row = await db.fetch_one(
            "SELECT limit_value FROM platform.tenant_limit_overrides "
            "WHERE tenant_id=$1 AND limit_key='probe_key'",
            tenant_id,
        )
        check(row is not None and row["limit_value"] == 500, "an override can be written and read")

        # Upsert is idempotent rather than accumulating rows.
        await db.execute(
            """
            INSERT INTO platform.tenant_limit_overrides (tenant_id, limit_key, limit_value, reason)
            VALUES ($1, 'probe_key', 900, 'probe again')
            ON CONFLICT (tenant_id, limit_key) DO UPDATE
               SET limit_value = EXCLUDED.limit_value, reason = EXCLUDED.reason, updated_at = now()
            """,
            tenant_id,
        )
        n = await db.fetch_one(
            "SELECT count(*) AS n, max(limit_value) AS v "
            "FROM platform.tenant_limit_overrides WHERE tenant_id=$1",
            tenant_id,
        )
        check(
            n is not None and n["n"] == 1 and n["v"] == 900,
            "setting the same key twice updates in place instead of adding a row",
        )

        # NULL limit_value is accepted and means unlimited.
        await db.execute(
            """
            INSERT INTO platform.tenant_limit_overrides (tenant_id, limit_key, limit_value, reason)
            VALUES ($1, 'probe_unlimited', NULL, 'explicitly uncapped')
            """,
            tenant_id,
        )
        unl = await db.fetch_one(
            "SELECT limit_value FROM platform.tenant_limit_overrides "
            "WHERE tenant_id=$1 AND limit_key='probe_unlimited'",
            tenant_id,
        )
        check(
            unl is not None and unl["limit_value"] is None,
            "a NULL limit_value is stored, not rejected (explicitly unlimited)",
        )

        # reason really is required.
        try:
            await db.execute(
                "INSERT INTO platform.tenant_limit_overrides "
                "(tenant_id, limit_key, reason) VALUES ($1,'probe_noreason',NULL)",
                tenant_id,
            )
            check(False, "an override without a reason is refused by the database")
        except Exception:
            check(True, "an override without a reason is refused by the database")

        # --- the status statement the route actually runs ---------------------
        changed = await db.fetch_one(
            """
            UPDATE platform.tenants t
               SET status = $2, updated_at = now()
              FROM (SELECT id, status FROM platform.tenants WHERE id = $1 FOR UPDATE) prev
             WHERE t.id = prev.id
            RETURNING prev.status AS previous_status, t.status AS status
            """,
            tenant_id,
            "suspended",
        )
        check(
            changed is not None
            and changed["previous_status"] == "active"
            and changed["status"] == "suspended",
            "set_status returns the old and new status from one statement",
        )

        missing = await db.fetch_one(
            """
            UPDATE platform.tenants t
               SET status = $2
              FROM (SELECT id, status FROM platform.tenants WHERE id = $1 FOR UPDATE) prev
             WHERE t.id = prev.id
            RETURNING prev.status AS previous_status, t.status AS status
            """,
            str(uuid.uuid4()),
            "suspended",
        )
        check(missing is None, "set_status on an unknown tenant returns nothing (-> 404)")

        # A tenant-scoped request must not see another tenant's overrides.
        #
        # Bound through `tenant_scope`, which is exactly how the application
        # does it: the adapter pins app.current_tenant with is_local=true inside
        # a transaction. An earlier version of this probe called set_config
        # directly with is_local=false and got a false failure, because the next
        # statement came from a different connection in the pool. That is worth
        # recording: a probe that binds the tenant differently from the app is
        # testing something the app never does.
        with tenant_scope(str(uuid.uuid4())):
            leaked = await db.fetch(
                "SELECT limit_key FROM platform.tenant_limit_overrides WHERE tenant_id = $1",
                tenant_id,
            )
        check(leaked == [], "a tenant-scoped session cannot read another tenant's overrides")

        with tenant_scope(tenant_id):
            own = await db.fetch(
                "SELECT limit_key FROM platform.tenant_limit_overrides WHERE tenant_id = $1",
                tenant_id,
            )
        check(len(own) == 2, "a tenant-scoped session does see its own overrides")

        visible = await db.fetch(
            "SELECT limit_key FROM platform.tenant_limit_overrides WHERE tenant_id = $1",
            tenant_id,
        )
        check(len(visible) == 2, "an admin session with no tenant bound sees them all")

        # Known gap, recorded rather than hidden: platform.tenants has no RLS.
        #
        # Every table carrying a tenant_id column is row-isolated. tenants and
        # users are not, because they are keyed by `id` and the standard policy
        # predicate does not apply to them -- and because token exchange and
        # signup have to read them before any tenant is bound. Isolation for
        # those two is therefore an application-layer property only.
        #
        # This asserts the gap as it currently stands. If someone adds RLS to
        # platform.tenants, this check fails and forces them to come back here
        # and delete the note, rather than leaving a comment that has quietly
        # become false.
        tenants_rls = await db.fetch_one(
            "SELECT relrowsecurity FROM pg_class WHERE oid = 'platform.tenants'::regclass"
        )
        check(
            tenants_rls is not None and tenants_rls["relrowsecurity"] is False,
            "platform.tenants has no RLS (known gap; isolation is application-layer)",
        )

        # --- deletion cascades ------------------------------------------------
        await db.execute("DELETE FROM platform.tenants WHERE id = $1", tenant_id)
        orphans = await db.fetch_one(
            "SELECT count(*) AS n FROM platform.tenant_limit_overrides WHERE tenant_id = $1",
            tenant_id,
        )
        check(
            orphans is not None and orphans["n"] == 0,
            "deleting a tenant removes its overrides rather than orphaning them",
        )

    finally:
        # tenant_scope is a ContextVar bound per statement, so there is no session
        # state to unwind -- only the fixture rows.
        await db.execute("DELETE FROM platform.tenants WHERE id = $1", tenant_id)
        await db.execute("DELETE FROM platform.users WHERE id = $1", user_id)
        await db.disconnect()

    passed = sum(1 for ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} checks passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
