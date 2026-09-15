#!/usr/bin/env python3
"""Check that every query against a tenant-scoped table filters by tenant.

Eight tables in the ``platform`` schema carry a ``tenant_id`` but have no RLS
policy, so isolation there rests entirely on each query saying so. That is a
property nobody can hold in their head across a growing codebase, and the
failure mode is silent: a forgotten predicate returns another tenant's rows
with no error.

This is a blunt textual check, not a parser. It reports statements that name
one of those tables without mentioning ``tenant_id`` nearby, for a human to
judge. False positives are expected and preferable to silence.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Tables with a tenant_id column but no RLS policy. Keep in step with
# scripts/audit_rls.py.
UNPROTECTED = (
    "platform.ai_usage",
    "platform.billing_events",
    "platform.entitlements",
    "platform.jobs",
    "platform.memberships",
    "platform.opportunity_matches",
    "platform.org_profiles",
    "platform.subscriptions",
)

SEARCH_DIRS = ("services", "packages")

# A statement is the unit of judgement: a query can mention the table on one
# line and the predicate several lines later.
STATEMENT = re.compile(
    r"(?is)\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b.*?(?=;|\"\"\")"
)


def main() -> int:
    findings: list[tuple[str, str, str]] = []

    for directory in SEARCH_DIRS:
        for path in (ROOT / directory).rglob("*.py"):
            if "test" in path.parts or path.name.startswith("test_"):
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for table in UNPROTECTED:
                if table not in text:
                    continue
                for match in STATEMENT.finditer(text):
                    stmt = match.group(0)
                    if table not in stmt:
                        continue
                    if "tenant_id" in stmt:
                        continue
                    line = text[: match.start()].count("\n") + 1
                    findings.append(
                        (f"{path.relative_to(ROOT)}:{line}", table, " ".join(stmt.split())[:110])
                    )

    if not findings:
        print("No unfiltered access to an unprotected tenant-scoped table.")
        return 0

    print(f"{len(findings)} statement(s) to review:\n")
    for where, table, snippet in findings:
        print(f"  {where}\n    table: {table}\n    {snippet}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
