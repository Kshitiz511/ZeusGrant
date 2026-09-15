#!/usr/bin/env python3
"""End-to-end check of the guarded path against a LOCAL RLS-enabled database.

Exercises the interaction the unit tests cannot: a real HTTP request where the
guard binds a tenant and Postgres then applies the policy to every query. Two
things have to be true at once, and they pull in opposite directions -- the
tenant's own data must come back, and another tenant's must not.

    .venv/bin/python scripts/probe_local_isolation.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
BASE = os.environ.get("ZEUS_LOCAL_URL", "http://localhost:8000")
DSN = os.environ.get("ZEUS_DATABASE_URL", "postgresql://zeus:zeus@localhost:5433/zeus")
JWT_SECRET = os.environ.get(
    "ZEUS_SUPABASE_JWT_SECRET", "local-dev-secret-local-dev-secret-xx"
)

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((ok, name, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{'  ' + detail if detail else ''}")


async def main() -> int:
    if "localhost" not in DSN and "127.0.0.1" not in DSN:
        print("Refusing to run against a non-local database.")
        return 1

    sys.path[:0] = [
        str(ROOT / p) for p in ("packages/config/src", "packages/adapters/src")
    ]
    import asyncpg
    import jwt

    conn = await asyncpg.connect(DSN, timeout=30)
    try:
        rows = await conn.fetch(
            """
            SELECT m.user_id, m.tenant_id, m.role, t.name
              FROM platform.memberships m
              JOIN platform.tenants t ON t.id = m.tenant_id
             ORDER BY t.created_at DESC
             LIMIT 2
            """
        )
    finally:
        await conn.close()

    if len(rows) < 2:
        print("Need two tenants locally; sign up twice first.")
        return 1

    me, other = rows[0], rows[1]
    print(f"\ncaller : {me['name']}\ntarget : {other['name']}\n")

    token = jwt.encode(
        {
            "sub": str(me["user_id"]),
            "tenant_id": str(me["tenant_id"]),
            "email": "probe@example.com",
            "role": "authenticated",
            "aud": "authenticated",
            "exp": 4102444800,
        },
        JWT_SECRET,
        algorithm="HS256",
    )
    auth = {"Authorization": f"Bearer {token}"}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{BASE}/entitlements/me", headers=auth)
        check(
            "own tenant readable through the guard with RLS on",
            r.status_code == 200 and r.json().get("tenant_id") == str(me["tenant_id"]),
            f"HTTP {r.status_code}",
        )
        modules = list(r.json().get("modules") or {}) if r.status_code == 200 else []
        check(
            "entitlements survive the policy (not silently emptied)",
            len(modules) == 2,
            f"modules={modules}",
        )

        r = await client.get(
            f"{BASE}/entitlements/me",
            headers={**auth, "X-Tenant-Id": str(other["tenant_id"])},
        )
        check(
            "foreign tenant refused via X-Tenant-Id",
            r.status_code == 404,
            f"HTTP {r.status_code}",
        )

        r = await client.get(f"{BASE}/grants/profile", headers=auth)
        check("guarded module route reachable", r.status_code == 200, f"HTTP {r.status_code}")

    failed = [x for x in results if not x[0]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
