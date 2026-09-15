"""End-to-end probe of the Grant Intelligence endpoints the console calls.

Runs against the locally running combined entrypoint (``api.index:app``) over
HTTP, so it exercises the same mounts, middleware and serialisation the browser
hits rather than an in-process shortcut.

The access token is minted directly from the container's auth service because
the dev token route is (correctly) disabled. Same signing key, no new surface.

Usage::

    .venv/bin/python scripts/probe_grants_console.py [base_url]
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any

import httpx
from zeus_platform_core.container import Container

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
CORE = f"{BASE}/api/core"

passed = 0
failed = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {name}")
    else:
        failed += 1
        print(f"  FAIL  {name} {detail}")


async def main() -> int:
    container = Container()
    await container.startup()
    try:
        row = await container.db.fetch_one(
            "SELECT tenant_id::text AS t FROM platform.org_profiles LIMIT 1"
        )
        if not row:
            print("No org profile in the local database; nothing to probe.")
            return 1
        tenant_id = row["t"]
        token = await container.auth.issue_claims("probe-user", tenant_id, ["owner"])
    finally:
        await container.shutdown()

    headers = {"Authorization": f"Bearer {token}"}
    print(f"tenant {tenant_id}\n")

    async with httpx.AsyncClient(base_url=CORE, headers=headers, timeout=30) as c:
        print("profile")
        r = await c.get("/grants/profile")
        check("GET /grants/profile is 200", r.status_code == 200, r.text[:200])
        profile: dict[str, Any] = r.json() or {}
        # The UI reads is_scoreable from the server rather than deciding for
        # itself, so its absence would silently break the scan gate.
        check("profile carries is_scoreable", "is_scoreable" in profile)

        r = await c.get("/grants/eligibility-codes")
        codes = r.json().get("codes", []) if r.status_code == 200 else []
        check("GET /grants/eligibility-codes is 200", r.status_code == 200, r.text[:200])
        check("codes are non-empty", len(codes) > 0)
        check(
            "code shape matches the form",
            bool(codes) and {"code", "description"} <= set(codes[0]),
            str(codes[:1]),
        )

        print("\nmatches")
        r = await c.get("/grants/matches", params={"limit": 3, "offset": 0})
        check("GET /grants/matches is 200", r.status_code == 200, r.text[:200])
        page = r.json() if r.status_code == 200 else {}
        check(
            "page carries the plan window",
            {"matches", "total", "visible_limit", "truncated", "offset"} <= set(page),
            str(sorted(page)),
        )
        rows = page.get("matches", [])
        if rows:
            m = rows[0]
            check(
                "match row has the fields the card renders",
                {"id", "match_id", "title", "score", "reasons", "closes_on"} <= set(m),
                str(sorted(m)[:12]),
            )
            # A score with no visible reasoning is what made the legacy fit
            # score untrustworthy, so an empty breakdown is a real failure.
            check(
                "match carries a scoring breakdown",
                bool(m.get("reasons")),
                str(m.get("reasons")),
            )
        else:
            print("  SKIP  no matches stored for this tenant")

        r = await c.get("/grants/matches/summary")
        summary = r.json() if r.status_code == 200 else {}
        check("GET /grants/matches/summary is 200", r.status_code == 200, r.text[:200])
        check(
            "summary has the stat-card fields",
            {"active", "saved", "dismissed", "strong", "last_scored_at", "scans"} <= set(summary),
            str(sorted(summary)),
        )
        check(
            "summary embeds scan usage",
            {"used", "limit", "remaining"} <= set(summary.get("scans") or {}),
            str(summary.get("scans")),
        )

        print("\nsave and dismiss")
        if rows:
            oid = rows[0]["id"]
            r = await c.post(f"/grants/matches/{oid}/state", json={"saved": True})
            check("save returns 200", r.status_code == 200, r.text[:200])
            check("saved_at is set", bool((r.json() or {}).get("saved_at")))
            r = await c.post(f"/grants/matches/{oid}/state", json={"saved": False})
            check("unsave clears saved_at", r.status_code == 200 and not r.json().get("saved_at"))
        else:
            print("  SKIP  nothing to save")

        print("\nscans")
        r = await c.get("/grants/usage")
        usage = r.json() if r.status_code == 200 else {}
        check("GET /grants/usage is 200", r.status_code == 200, r.text[:200])
        check("usage has used/limit/remaining", {"used", "limit", "remaining"} <= set(usage))

        r = await c.post("/grants/scan")
        # All three are states the UI handles: queued, plan ceiling, incomplete
        # profile. Anything else means the button has no defined behaviour.
        check(
            "POST /grants/scan answers 202, 402 or 409",
            r.status_code in (202, 402, 409),
            f"got {r.status_code} {r.text[:200]}",
        )
        if r.status_code == 202:
            body = r.json()
            check(
                "scan returns a pollable job",
                {"job_id", "status", "already_running"} <= set(body),
                str(sorted(body)),
            )
            job_id = body["job_id"]
            r2 = await c.get(f"/grants/scan/{job_id}")
            check("GET /grants/scan/{id} is 200", r2.status_code == 200, r2.text[:200])
            check(
                "job status has what the poller reads",
                {"id", "status"} <= set(r2.json() or {}),
                str(sorted(r2.json() or {})),
            )
            # Asking twice must collapse onto the same job rather than
            # spending a second scan from the plan.
            r3 = await c.post("/grants/scan")
            check(
                "a second scan collapses onto the first",
                r3.status_code == 202 and r3.json().get("job_id") == job_id,
                r3.text[:200],
            )

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
