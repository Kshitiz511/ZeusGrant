#!/usr/bin/env python3
"""Audit row-level security coverage across every tenant-scoped table.

The rule this checks: if a table has a ``tenant_id`` column it holds one
tenant's data, so it must have RLS both ENABLED and FORCED plus at least one
policy. ENABLE alone exempts the table owner, which is the gap that looks fine
locally and is not fine in production.

Read-only. Points at production by default.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.production.local"

QUERY = """
SELECT n.nspname AS schema,
       c.relname AS table,
       c.relrowsecurity      AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
       EXISTS (
           SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = n.nspname
              AND col.table_name  = c.relname
              AND col.column_name = 'tenant_id'
       ) AS tenant_scoped
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname IN ('platform', 'contract_compliance')
 ORDER BY 1, 2
"""


def dsn() -> str:
    url = os.environ.get("ZEUS_DATABASE_URL")
    if url:
        return url
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("ZEUS_DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("No ZEUS_DATABASE_URL found.")


async def main() -> int:
    import asyncpg

    conn = await asyncpg.connect(dsn(), timeout=30, statement_cache_size=0)
    try:
        rows = await conn.fetch(QUERY)
    finally:
        await conn.close()

    print(f"\n{'table':<44}{'tenant':<8}{'RLS':<7}{'FORCE':<7}{'policies':<10}")
    print("-" * 78)

    gaps: list[str] = []
    for r in rows:
        name = f"{r['schema']}.{r['table']}"
        scoped = r["tenant_scoped"]
        ok = (not scoped) or (r["rls_enabled"] and r["rls_forced"] and r["policies"] > 0)
        if not ok:
            gaps.append(name)
        print(
            f"{name:<44}{str(scoped):<8}{str(r['rls_enabled']):<7}"
            f"{str(r['rls_forced']):<7}{r['policies']:<10}{'' if ok else '<-- GAP'}"
        )

    print()
    if gaps:
        print(f"{len(gaps)} tenant-scoped table(s) without enforced isolation:")
        for g in gaps:
            print(f"  {g}")
        return 1
    print("Every tenant-scoped table has RLS enabled, forced, and a policy.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
