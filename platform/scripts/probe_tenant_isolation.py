#!/usr/bin/env python3
"""Can a signed-in user read another tenant's data by asking?

The tenant for a request is resolved as ``X-Tenant-Id or session.tenant_id``,
and nothing checks that the caller belongs to the tenant named in that header.
This probe takes one real user's token and points it at a tenant they are not
a member of.

Read-only: GETs only, and it prints no tenant content beyond what is needed to
show whether isolation held.

    .venv/bin/python scripts/probe_tenant_isolation.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"
BASE = os.environ.get("ZEUS_PROD_URL", "https://zeus-platform-dun.vercel.app")

PROBES = (
    "/api/core/entitlements/me",
    "/api/core/grants/profile",
    "/api/core/grants/matches",
    "/api/cc/contracts",
)


def _load_env() -> None:
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


async def main() -> int:
    _load_env()
    sys.path[:0] = [
        str(ROOT / p)
        for p in (
            "packages/config/src",
            "packages/adapters/src",
            "packages/service-kit/src",
            "services/platform-core/src",
        )
    ]
    import asyncpg
    from zeus_platform_core.container import Container

    conn = await asyncpg.connect(
        os.environ["ZEUS_DATABASE_URL"], timeout=30, statement_cache_size=0
    )
    try:
        attacker = await conn.fetchrow(
            """
            SELECT u.id AS user_id, u.email, m.tenant_id, m.role, t.name
              FROM platform.users u
              JOIN platform.memberships m ON m.user_id = u.id
              JOIN platform.tenants t ON t.id = m.tenant_id
             WHERE lower(u.email) = lower($1)
            """,
            "beboyshitij@gmail.com",
        )
        victim = await conn.fetchrow(
            """
            SELECT t.id, t.name
              FROM platform.tenants t
             WHERE t.id <> $1
               AND EXISTS (SELECT 1 FROM platform.subscriptions s
                            WHERE s.tenant_id = t.id)
             ORDER BY t.name
             LIMIT 1
            """,
            attacker["tenant_id"],
        )
        # Proves the two are genuinely unrelated, so a success below cannot be
        # explained away as a legitimate multi-workspace membership.
        shared = await conn.fetchval(
            """
            SELECT count(*) FROM platform.memberships
             WHERE user_id = $1 AND tenant_id = $2
            """,
            attacker["user_id"],
            victim["id"],
        )
    finally:
        await conn.close()

    print(f"\ncaller : {attacker['email']}  (tenant: {attacker['name']})")
    print(f"target : {victim['name']}  ({victim['id']})")
    print(f"caller is a member of target: {bool(shared)}\n")

    if shared:
        print("Chose a tenant the caller belongs to; the probe proves nothing.")
        return 1

    token = await Container().auth.issue_claims(
        str(attacker["user_id"]), str(attacker["tenant_id"]), [attacker["role"]]
    )

    leaked = 0
    async with httpx.AsyncClient(timeout=30) as client:
        for path in PROBES:
            r = await client.get(
                f"{BASE}{path}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "X-Tenant-Id": str(victim["id"]),
                },
            )
            if r.status_code == 200:
                leaked += 1
                print(f"  LEAK    200  {path}")
                print(f"          {r.text[:160]}")
            else:
                print(f"  blocked {r.status_code}  {path}")

    print()
    if leaked:
        print(f"{leaked}/{len(PROBES)} endpoints served another tenant's data.")
        return 1
    print("Isolation held on every endpoint.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
