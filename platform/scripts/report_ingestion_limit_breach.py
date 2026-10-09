"""Read-only: would seeding the ingestion limits block anyone today?

Run before migration 0021 reaches a database. For every tenant with an active
Contract Compliance subscription, compares this month's document and page
totals, and their largest document, against the limits 0021 would seed for
their plan. Reports any tenant who would be over. Writes nothing.

    .venv/bin/python scripts/report_ingestion_limit_breach.py [--production]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _dsn import resolve_dsn  # noqa: E402

PROPOSED = {
    "cc_starter": (200, 20, 600),
    "cc_growth": (400, 100, 3000),
    "cc_professional": (600, 300, 10000),
    "cc_agency": (600, 1000, 30000),
}

QUERY = """
SELECT s.tenant_id::text, s.plan_id,
       count(d.id) FILTER (WHERE d.created_at >= date_trunc('month', now())) AS docs_month,
       coalesce(sum(d.pages) FILTER (WHERE d.created_at >= date_trunc('month', now())), 0)
           AS pages_month,
       coalesce(max(d.pages), 0) AS largest
  FROM platform.subscriptions s
  LEFT JOIN contract_compliance.documents d ON d.tenant_id = s.tenant_id
 WHERE s.module_id = 'contract_compliance'
   AND s.status IN ('active', 'trialing')
 GROUP BY s.tenant_id, s.plan_id
"""


async def main() -> int:
    import asyncpg

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--production", action="store_true")
    dsn = resolve_dsn(production=p.parse_args().production)
    conn = await asyncpg.connect(dsn, timeout=30)
    try:
        rows = await conn.fetch(QUERY)
    finally:
        await conn.close()

    breaches = 0
    for r in rows:
        caps = PROPOSED.get(r["plan_id"])
        if caps is None:
            continue
        per_doc, docs, pages = caps
        over = []
        if r["largest"] > per_doc:
            over.append(f"largest doc {r['largest']}p > {per_doc}")
        if r["docs_month"] > docs:
            over.append(f"{r['docs_month']} docs > {docs}")
        if r["pages_month"] > pages:
            over.append(f"{r['pages_month']} pages > {pages}")
        if over:
            breaches += 1
            print(f"  OVER  {r['tenant_id']} {r['plan_id']}: {'; '.join(over)}")
    print(f"{len(rows)} subscribed tenant(s) checked, {breaches} would be over the new limits")
    return 1 if breaches else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
