#!/usr/bin/env python3
"""Call what the console calls on first paint, as a real production user.

A blank page tells you nothing about which request failed, because the console
has no error boundary. This replays the same sequence over HTTP with a token
minted from the same signing key, so a 500 shows up as a 500 instead of as an
empty screen.

Read-only: every endpoint here is a GET.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import announce  # noqa: E402

BASE = os.environ.get("ZEUS_PROD_URL", "https://zeus-platform-dun.vercel.app")

EMAIL = sys.argv[1] if len(sys.argv) > 1 else "beboyshitij@gmail.com"

# Exactly what the console requests once a session is restored.
FIRST_PAINT = [
    "/api/core/entitlements/me",
    "/api/core/tenancy/mine",
    "/api/cc/contracts",
    "/api/core/grants/profile",
    "/api/core/grants/matches",
    "/api/core/grants/matches/summary",
]


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
        announce(
            os.environ["ZEUS_DATABASE_URL"],
            role="runtime",
            purpose="first-paint probe",
        ),
        timeout=30,
        statement_cache_size=0
    )
    try:
        row = await conn.fetchrow(
            """
            SELECT u.id AS user_id, m.tenant_id, m.role, t.name
              FROM platform.users u
              JOIN platform.memberships m ON m.user_id = u.id
              JOIN platform.tenants t ON t.id = m.tenant_id
             WHERE lower(u.email) = lower($1)
            """,
            EMAIL,
        )
    finally:
        await conn.close()

    if row is None:
        print(f"No such account in production: {EMAIL}")
        return 1

    print(f"\n{EMAIL}  tenant={row['name']}  role={row['role']}\n")

    container = Container()
    token = await container.auth.issue_claims(
        str(row["user_id"]), str(row["tenant_id"]), [row["role"]]
    )

    failures = 0
    async with httpx.AsyncClient(timeout=30) as client:
        for path in FIRST_PAINT:
            r = await client.get(
                f"{BASE}{path}", headers={"Authorization": f"Bearer {token}"}
            )
            flag = "ok " if r.status_code < 400 else "FAIL"
            if r.status_code >= 400:
                failures += 1
            print(f"  [{flag}] {r.status_code}  {path}")
            if r.status_code >= 400:
                print(f"         {r.text[:400]}")
            elif os.environ.get("ZEUS_PROBE_VERBOSE"):
                print(f"         {r.text[:500]}")

    print(f"\n{failures} failing endpoint(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
