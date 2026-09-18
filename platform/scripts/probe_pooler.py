#!/usr/bin/env python3
"""Probe both Supabase pooler endpoints.

Transaction-mode pgBouncer multiplexes connections, so a prepared statement
created on one backend may not exist on the next. asyncpg prepares implicitly
for every parameterised query, which is why the second identical query is the
one that fails. Running the query twice is the point of this probe.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import required_dsn  # noqa: E402


def load(name: str) -> str:
    return required_dsn(name, purpose="pooler reachability")


async def probe(label: str, url: str, **kwargs) -> bool:
    import asyncpg

    try:
        conn = await asyncio.wait_for(asyncpg.connect(url, **kwargs), timeout=25)
    except Exception as exc:
        print(f"  FAIL  {label}: {type(exc).__name__}: {exc}")
        return False
    try:
        version = await conn.fetchval("SHOW server_version")
        for _ in range(2):
            await conn.fetchval("SELECT $1::int", 1)
        print(f"  PASS  {label}: Postgres {version}")
        return True
    except Exception as exc:
        print(f"  FAIL  {label}: {type(exc).__name__}: {exc}")
        return False
    finally:
        await conn.close()


async def main() -> int:
    session_url = load("ZEUS_MIGRATE_URL")
    txn_url = load("ZEUS_DATABASE_URL")

    print("\nSupabase pooler probe\n")
    results = [
        await probe("session pooler :5432 (migrations)", session_url),
        await probe("txn pooler :6543, asyncpg defaults", txn_url),
        await probe(
            "txn pooler :6543, statement_cache_size=0", txn_url, statement_cache_size=0
        ),
    ]
    print()
    return 0 if results[0] and results[2] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
