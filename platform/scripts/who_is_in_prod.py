#!/usr/bin/env python3
"""Report who can actually sign in to production, and with what access.

Read-only. Answers three questions that are otherwise guesswork:
  1. Which accounts exist, and are they verified enough to log in?
  2. Is Google sign-in configured at all, or is the button a dead end?
  3. What modules does each tenant hold, so "do I have full access" has an
     answer that comes from the database rather than from memory?
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import required_dsn  # noqa: E402


def dsn() -> str:
    return required_dsn(
        "ZEUS_DATABASE_URL", role="zeus_app", purpose="account listing, read-only"
    )


async def main() -> int:
    import asyncpg

    conn = await asyncpg.connect(dsn(), timeout=30, statement_cache_size=0)
    try:
        print("\n=== accounts ===")
        users = await conn.fetch(
            """
            SELECT u.email,
                   u.auth_provider,
                   u.email_verified_at IS NOT NULL AS verified,
                   EXISTS (SELECT 1 FROM platform.user_credentials c
                            WHERE c.user_id = u.id)          AS has_password,
                   (SELECT string_agg(i.provider, ',')
                      FROM platform.user_identities i
                     WHERE i.user_id = u.id)                 AS identities,
                   t.name AS tenant,
                   m.role AS role
              FROM platform.users u
              LEFT JOIN platform.memberships m ON m.user_id = u.id
              LEFT JOIN platform.tenants t     ON t.id = m.tenant_id
             ORDER BY u.created_at
            """
        )
        if not users:
            print("  (none — nobody can sign in)")
        for u in users:
            print(
                f"  {u['email']:<34} verified={u['verified']!s:<5} "
                f"password={u['has_password']!s:<5} "
                f"provider={u['auth_provider']!s:<10} "
                f"linked={u['identities'] or '-':<8} "
                f"role={u['role']!s:<7} tenant={u['tenant']}"
            )

        print("\n=== entitlements per tenant ===")
        rows = await conn.fetch(
            """
            SELECT t.name, s.module_id, s.plan_id, s.status
              FROM platform.subscriptions s
              JOIN platform.tenants t ON t.id = s.tenant_id
             ORDER BY t.name, s.module_id
            """
        )
        if not rows:
            print("  (none)")
        for r in rows:
            print(f"  {r['name']:<28} {r['module_id']:<22} {r['plan_id']:<16} {r['status']}")

        print("\n=== catalogue size ===")
        n = await conn.fetchval("SELECT count(*) FROM platform.opportunities")
        print(f"  opportunities: {n}")
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
