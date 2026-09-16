#!/usr/bin/env python
"""Verify platform-admin identity against a real Postgres, as the app role.

The unit tests in ``test_platform_admin.py`` run against a fake database and so
can prove how the application behaves, but not what the database permits. Two
of the guarantees in migration 0016 live entirely in the database:

* ``platform.admin_audit`` is append-only, enforced by revoked privileges
* the flag defaults to false, so a new account is not an operator

Neither can be observed through the fake. This connects as ``zeus_app`` -- the
non-superuser role production actually uses -- and tries the forbidden things.
A run as ``zeus`` would pass while proving nothing, because a superuser
bypasses exactly the controls under test.

    PGURL=postgresql://zeus_app:...@localhost:5433/zeus \\
        python scripts/probe_platform_admin.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "packages/adapters/src"))

import asyncpg  # noqa: E402

PASSED = 0
FAILED = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global PASSED, FAILED
    if ok:
        PASSED += 1
        print(f"  PASS  {label}")
    else:
        FAILED += 1
        print(f"  FAIL  {label} {detail}")


async def main() -> int:
    dsn = os.environ.get("PGURL")
    if not dsn:
        sys.exit("Set PGURL to a zeus_app DSN (not the superuser).")

    conn = await asyncpg.connect(dsn)
    try:
        who = await conn.fetchval("SELECT current_user")
        print(f"Connected as: {who}")
        if who != "zeus_app":
            print("  WARNING: not zeus_app. A superuser bypasses the controls under test,")
            print("           so a pass here would mean nothing.")

        # --- schema ------------------------------------------------------
        col = await conn.fetchrow(
            """
            SELECT data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema='platform' AND table_name='users'
              AND column_name='is_platform_admin'
            """
        )
        check("users.is_platform_admin exists", col is not None)
        if col:
            check("  it is boolean", col["data_type"] == "boolean", str(col["data_type"]))
            check("  it is NOT NULL", col["is_nullable"] == "NO", str(col["is_nullable"]))
            # Defaulting to true would silently make every existing account an
            # operator the moment the migration ran.
            check(
                "  it defaults to false",
                "false" in (col["column_default"] or ""),
                str(col["column_default"]),
            )

        check(
            "admin_audit table exists",
            await conn.fetchval(
                "SELECT to_regclass('platform.admin_audit') IS NOT NULL"
            ),
        )

        check(
            "admin_audit is outside RLS",
            not await conn.fetchval(
                "SELECT relrowsecurity FROM pg_class WHERE oid='platform.admin_audit'::regclass"
            ),
            "it has RLS enabled, which would hide rows from unbound connections",
        )

        # --- privileges --------------------------------------------------
        for priv, expected in (("INSERT", True), ("SELECT", True),
                               ("UPDATE", False), ("DELETE", False)):
            granted = await conn.fetchval(
                "SELECT has_table_privilege('zeus_app', 'platform.admin_audit', $1)", priv
            )
            check(
                f"zeus_app {'may' if expected else 'may NOT'} {priv} admin_audit",
                granted == expected,
                f"got {granted}",
            )

        # --- behaviour, not just catalogue -------------------------------
        # A privilege check reads the catalogue; this proves the catalogue is
        # telling the truth.
        row_id = await conn.fetchval(
            """
            INSERT INTO platform.admin_audit (action, target_type, target_id, after)
            VALUES ('probe.append_only', 'probe', 'x', '{"probe":true}'::jsonb)
            RETURNING id
            """
        )
        check("an audit row can be written", row_id is not None)

        try:
            await conn.execute(
                "UPDATE platform.admin_audit SET action='tampered' WHERE id=$1", row_id
            )
            check("an audit row cannot be rewritten", False, "UPDATE succeeded")
        except asyncpg.InsufficientPrivilegeError:
            check("an audit row cannot be rewritten", True)

        try:
            await conn.execute("DELETE FROM platform.admin_audit WHERE id=$1", row_id)
            check("an audit row cannot be deleted", False, "DELETE succeeded")
        except asyncpg.InsufficientPrivilegeError:
            check("an audit row cannot be deleted", True)

        still = await conn.fetchval(
            "SELECT count(*) FROM platform.admin_audit WHERE id=$1", row_id
        )
        check("the row survived both attempts", still == 1, f"count={still}")
        # Deliberately left in place: the application cannot remove it, which
        # is the property being demonstrated. Clean up as the owner if wanted.
        print(f"\n  note: probe row {row_id} remains by design; zeus_app cannot delete it.")

        # --- who currently holds the flag --------------------------------
        admins = await conn.fetch(
            "SELECT email FROM platform.users WHERE is_platform_admin ORDER BY email"
        )
        print(f"\nPlatform admins: {len(admins)}")
        for a in admins:
            print(f"  - {a['email']}")

        print(f"\n{PASSED} passed, {FAILED} failed")
        return 1 if FAILED else 0
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
