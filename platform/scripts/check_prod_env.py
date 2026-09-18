#!/usr/bin/env python3
"""Check that every service named in .env.production.local is reachable.

Run before deploying. Each failure here would otherwise surface as an opaque
500 on a cold start in production, where it is far more expensive to debug.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parent.parent / ".env.production.local"

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import announce  # noqa: E402


def load_env() -> dict[str, str]:
    if not ENV_FILE.exists():
        print(f"Missing {ENV_FILE}. Run scripts/make_prod_env.py first.")
        sys.exit(1)
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


async def check_postgres(label: str, url: str) -> tuple[bool, str]:
    import asyncpg

    announce(url, role=label, purpose="connectivity check")

    # Mirror PostgresDatabase: the transaction pooler (:6543) hands each query a
    # different backend, so asyncpg's prepared-statement cache collides.
    kwargs: dict[str, object] = {}
    if ":6543" in url:
        kwargs["statement_cache_size"] = 0
        kwargs["max_cacheable_statement_size"] = 0

    try:
        conn = await asyncio.wait_for(asyncpg.connect(url, **kwargs), timeout=20)
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    try:
        version = await conn.fetchval("SHOW server_version")
        return True, f"Postgres {version}"
    finally:
        await conn.close()


async def check_redis(url: str) -> tuple[bool, str]:
    import certifi
    import redis.asyncio as redis

    # Mirror RedisCache: pin the CA bundle rather than trusting the host store,
    # so this probe fails for the same reasons the app would.
    kwargs = {"ssl_ca_certs": certifi.where()} if url.startswith("rediss://") else {}
    client = redis.from_url(url, **kwargs)
    try:
        await asyncio.wait_for(client.ping(), timeout=15)
        return True, "PONG"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
    finally:
        await client.aclose()


async def check_https(label: str, url: str, headers: dict[str, str]) -> tuple[bool, str]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.get(url, headers=headers)
        # 401/403 still proves the host resolves and TLS works, which is what
        # this check is really for; auth correctness is tested elsewhere.
        return res.status_code < 500, f"HTTP {res.status_code}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


async def main() -> int:
    env = load_env()
    todos = [k for k, v in env.items() if v.startswith("TODO")]

    results: list[tuple[str, bool, str]] = []

    direct = env.get("ZEUS_MIGRATE_URL", "")
    if direct and not direct.startswith("TODO"):
        ok, detail = await check_postgres("direct", direct)
        results.append(("Postgres (direct :5432, migrations)", ok, detail))

    pooler = env.get("ZEUS_DATABASE_URL", "")
    if pooler and not pooler.startswith("TODO"):
        ok, detail = await check_postgres("pooler", pooler)
        results.append(("Postgres (pooler :6543, runtime)", ok, detail))

    redis_url = env.get("ZEUS_REDIS_URL", "")
    if redis_url and not redis_url.startswith("TODO"):
        ok, detail = await check_redis(redis_url)
        results.append(("Redis (Upstash)", ok, detail))

    sb_url = env.get("ZEUS_SUPABASE_URL", "")
    sb_key = env.get("ZEUS_SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = env.get("ZEUS_STORAGE_BUCKET", "evidence")
    if sb_url and not sb_url.startswith("TODO"):
        ok, detail = await check_https(
            "storage",
            f"{sb_url}/storage/v1/bucket/{bucket}",
            {"apikey": sb_key, "authorization": f"Bearer {sb_key}"},
        )
        results.append((f"Supabase Storage bucket '{bucket}'", ok, detail))

    qstash_token = env.get("ZEUS_QSTASH_TOKEN", "")
    if qstash_token and not qstash_token.startswith("TODO"):
        ok, detail = await check_https(
            "qstash",
            "https://qstash.upstash.io/v2/topics",
            {"authorization": f"Bearer {qstash_token}"},
        )
        results.append(("QStash", ok, detail))

    print("\nConnectivity check\n")
    failed = 0
    for label, ok, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {label:42} {detail}")
        if not ok:
            failed += 1

    if todos:
        print("\nStill to fill in:")
        for key in todos:
            print(f"  - {key}")

    print(f"\n{len(results) - failed} passed, {failed} failed, {len(todos)} unset")
    return 1 if failed or todos else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
