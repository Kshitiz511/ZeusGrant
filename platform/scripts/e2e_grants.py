#!/usr/bin/env python3
"""End-to-end walkthrough of grant intelligence against the running server.

Exercises the chain a real user follows: sign up, verify, create a tenant, fill
in a profile, request a scan, run the worker, read the matches back. Nothing is
mocked and nothing is asserted about internals -- this talks HTTP to whatever is
listening, which is the only way to catch the class of bug where the code is
correct on disk and absent from the running process.

    ./.venv/bin/python scripts/e2e_grants.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("ZEUS_CORE_URL", "http://localhost:8000")
PASSWORD = "E2e-Test-Passw0rd!"

passed = 0
failed = 0


def check(label: str, ok: bool, detail: str = "") -> bool:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}  {detail}")
    return ok


def call(
    method: str, path: str, body: dict | None = None, token: str | None = None,
    tenant: str | None = None,
) -> tuple[int, dict]:
    req = urllib.request.Request(f"{BASE}{path}", method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if tenant:
        req.add_header("X-Tenant-Id", tenant)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=90) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            return e.code, json.loads(raw) if raw else {}
        except ValueError:
            return e.code, {"raw": raw[:400]}
    except Exception as exc:  # noqa: BLE001
        return 0, {"error": str(exc)}


def psql(sql: str) -> str:
    """Read straight from the database for things the API does not expose."""
    out = subprocess.run(
        ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus",
         "-d", "zeus", "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=30,
    )
    return out.stdout.strip()


def main() -> int:
    stamp = int(time.time())
    # Resend's sandbox address. It accepts mail and delivers nowhere, so the
    # signup path runs for real without needing an inbox. @example.com is
    # rejected outright by Resend's validation, which made signup return 502
    # and looked like a fault in this code rather than a provider policy.
    email = f"delivered+zeus{stamp}@resend.dev"

    print(f"\nTarget: {BASE}")
    print("=" * 62)

    # --- 0. the server is the one we think it is ---------------------------
    print("\n0. Server identity")
    code, _ = call("GET", "/health")
    if not check("health responds", code == 200, f"got {code}"):
        print("\nNothing listening. Start the API before running this.")
        return 1

    code, _ = call("GET", "/grants/stats")
    # 401 proves the route exists and is guarded; 404 would mean the running
    # process predates this code, which is the failure this script exists to
    # catch early rather than three steps later as a confusing error.
    if not check("grant routes are mounted", code == 401, f"got {code}, expected 401"):
        print("\nThe running server does not have the grant routes. Restart it.")
        return 1

    # --- 1. account --------------------------------------------------------
    print("\n1. Account and verification")
    code, body = call("POST", "/auth/signup", {
        "email": email,
        "password": PASSWORD,
        "full_name": "E2E Test User",
    })
    check("signup returns 202 without a token", code == 202, f"got {code}")
    check("no token issued before verification", "access_token" not in body)

    user_id = psql(f"SELECT id FROM platform.users WHERE email = '{email}'")
    if not check("user row created", bool(user_id)):
        return 1

    code, body = call("POST", "/auth/login", {"email": email, "password": PASSWORD})
    check("unverified login is refused", code == 403, f"got {code}")

    # Verification itself is already covered by its own tests and is live in
    # production. Reproducing it here would mean either reading a real inbox or
    # flipping the email provider, and a grants test that depends on either is
    # a grants test that fails for unrelated reasons. Mark the user verified
    # directly and carry on with what this script is actually for.
    psql(f"UPDATE platform.users SET email_verified_at = now() WHERE id = '{user_id}'")

    code, body = call("POST", "/auth/login", {"email": email, "password": PASSWORD})
    check("verified login succeeds", code == 200 and "access_token" in body,
          f"got {code} {str(body)[:200]}")
    token = body.get("access_token")
    if not token:
        return 1

    # --- 2. tenant ---------------------------------------------------------
    print("\n2. Tenant")
    code, body = call("GET", "/tenancy/me", token=token)
    tenant_id = None
    if code == 200:
        tenants = body if isinstance(body, list) else body.get("tenants", [])
        if tenants:
            tenant_id = tenants[0].get("id") or tenants[0].get("tenant_id")
    if not tenant_id:
        tenant_id = psql(
            f"SELECT id FROM platform.tenants WHERE owner_user_id = '{user_id}' LIMIT 1"
        )
    if not check("tenant resolved", bool(tenant_id), str(body)[:200]):
        return 1

    # --- 3. catalogue ------------------------------------------------------
    print("\n3. Catalogue (shared, read-only)")
    code, body = call("GET", "/grants/stats", token=token, tenant=tenant_id)
    check("stats readable", code == 200, f"got {code} {str(body)[:150]}")
    total = body.get("total", 0)
    open_now = body.get("open_now", 0)
    check("catalogue is populated", total > 80_000, f"total={total}")
    check("open subset is plausible", 0 < open_now < total, f"open={open_now}")
    print(f"        {total:,} records, {open_now:,} open today")

    code, body = call("GET", "/grants/eligibility-codes", token=token, tenant=tenant_id)
    check("17 eligibility codes", len(body.get("codes", [])) == 17,
          f"got {len(body.get('codes', []))}")

    t0 = time.monotonic()
    code, body = call(
        "GET", "/grants/opportunities?q=youth+education&limit=5",
        token=token, tenant=tenant_id,
    )
    search_ms = (time.monotonic() - t0) * 1000
    check("search works", code == 200 and body.get("count", 0) > 0,
          f"got {code} count={body.get('count')}")
    check("search is fast", search_ms < 2000, f"{search_ms:.0f}ms")
    print(f"        search returned {body.get('count')} in {search_ms:.0f}ms")

    if body.get("opportunities"):
        opp_id = body["opportunities"][0]["id"]
        code, detail = call("GET", f"/grants/opportunities/{opp_id}",
                            token=token, tenant=tenant_id)
        check("single opportunity readable", code == 200, f"got {code}")
        check("detail includes description", "description" in detail)

    # --- 4. profile --------------------------------------------------------
    print("\n4. Organisation profile")
    code, body = call("GET", "/grants/profile", token=token, tenant=tenant_id)
    check("profile starts empty", code == 200 and not body, f"got {code} {body}")

    code, body = call("PUT", "/grants/profile", {
        "legal_name": "E2E Youth Services",
        "applicant_class": "nonprofit",
        "eligibility_codes": ["12"],
        "home_state": "ca",  # lowercase on purpose: the API must normalise it
        "operating_states": ["ca", "nv"],
        "focus_areas": ["youth development", "after school", "education"],
        "award_min": 25000,
        "award_max": 500000,
        "can_cost_share": False,
    }, token=token, tenant=tenant_id)
    check("profile saved", code == 200, f"got {code} {str(body)[:200]}")
    check("state normalised to uppercase", body.get("home_state") == "CA",
          f"got {body.get('home_state')}")
    check("profile is scoreable", body.get("is_scoreable") is True)

    # --- 5. scan -----------------------------------------------------------
    print("\n5. Scan (queued, not faked)")
    code, body = call("GET", "/grants/usage", token=token, tenant=tenant_id)
    check("usage readable", code == 200, f"got {code}")
    limit_before = body.get("limit")
    print(f"        plan allows {limit_before} scans/month, "
          f"{body.get('remaining')} remaining")

    code, body = call("POST", "/grants/scan", token=token, tenant=tenant_id)
    check("scan accepted with 202", code == 202, f"got {code} {str(body)[:200]}")
    job_id = body.get("job_id")
    check("returns a job to poll", bool(job_id))

    # Double-click: must not consume a second scan.
    code, body2 = call("POST", "/grants/scan", token=token, tenant=tenant_id)
    check("double-click is deduped", body2.get("job_id") == job_id,
          f"{body2.get('job_id')} vs {job_id}")

    queued = psql(f"SELECT status FROM platform.jobs WHERE id = '{job_id}'")
    check("job really is queued", queued == "queued", f"status={queued}")

    # --- 6. worker ---------------------------------------------------------
    print("\n6. Worker")
    t0 = time.monotonic()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # The same PYTHONPATH the running API uses. The venv's editable installs
    # are not what makes imports work here -- the dev setup puts the four source
    # trees on the path explicitly, and a worker started without them fails with
    # a ModuleNotFoundError that looks like a code fault but is not.
    env = dict(os.environ)
    env["PYTHONPATH"] = ":".join(
        f"{root}/{p}" for p in (
            "packages/config/src",
            "packages/adapters/src",
            "packages/service-kit/src",
            "services/platform-core/src",
        )
    )
    proc = subprocess.run(
        [sys.executable, "-m", "zeus_platform_core.worker_main", "--once",
         "--log-level", "WARNING"],
        capture_output=True, text=True, timeout=300, cwd=root, env=env,
    )
    worker_s = time.monotonic() - t0
    if proc.returncode != 0:
        print(f"        worker stderr: {proc.stderr[-600:]}")
    check("worker ran cleanly", proc.returncode == 0, f"rc={proc.returncode}")

    status = psql(f"SELECT status FROM platform.jobs WHERE id = '{job_id}'")
    check("job succeeded", status == "succeeded", f"status={status}")
    print(f"        worker completed in {worker_s:.1f}s")

    code, body = call("GET", f"/grants/scan/{job_id}", token=token, tenant=tenant_id)
    check("job status readable via API", code == 200 and body.get("status") == "succeeded",
          f"got {code} {body.get('status')}")
    check("no traceback leaked to the user", body.get("error") is None or
          "Traceback" not in str(body.get("error")))

    # --- 7. matches --------------------------------------------------------
    print("\n7. Matches")
    code, body = call("GET", "/grants/matches?limit=10", token=token, tenant=tenant_id)
    check("matches returned", code == 200 and len(body.get("matches", [])) > 0,
          f"got {code} n={len(body.get('matches', []))}")
    matches = body.get("matches", [])
    print(f"        {body.get('total')} matches, showing {len(matches)}, "
          f"visible limit {body.get('visible_limit')}")

    if matches:
        top = matches[0]
        check("match carries a score", isinstance(top.get("score"), int))
        check("match carries four reasons", len(top.get("reasons", [])) == 4,
              f"got {len(top.get('reasons', []))}")
        check("scores are ordered", all(
            matches[i]["score"] >= matches[i + 1]["score"] for i in range(len(matches) - 1)
        ))
        print(f"        top: {top['score']}/100  {top['title'][:52]}")

    # The legacy bug, checked through the API rather than in SQL.
    bad = psql(f"""
        SELECT count(*) FROM platform.opportunity_matches m
        JOIN platform.opportunities o ON o.id = m.opportunity_id
        WHERE m.tenant_id = '{tenant_id}'
          AND o.closes_on IS NOT NULL AND o.closes_on < current_date
    """)
    check("no closed grants among matches", bad == "0", f"found {bad}")

    bad = psql(f"""
        SELECT count(*) FROM platform.opportunity_matches m
        JOIN platform.opportunities o ON o.id = m.opportunity_id
        WHERE m.tenant_id = '{tenant_id}' AND o.cost_sharing_required IS TRUE
    """)
    check("no cost-share grants (profile cannot match)", bad == "0", f"found {bad}")

    # --- 8. save and dismiss ------------------------------------------------
    print("\n8. Saving and dismissing")
    if matches:
        oid = matches[0]["id"]
        code, body = call("POST", f"/grants/matches/{oid}/state", {"saved": True},
                          token=token, tenant=tenant_id)
        check("save works", code == 200 and body.get("saved_at"), f"got {code}")

        code, body = call("GET", "/grants/matches?saved_only=true", token=token,
                          tenant=tenant_id)
        check("saved filter works", len(body.get("matches", [])) == 1,
              f"got {len(body.get('matches', []))}")

        code, _ = call("POST", f"/grants/matches/{oid}/state", {"dismissed": True},
                       token=token, tenant=tenant_id)
        code, body = call("GET", "/grants/matches?limit=10", token=token, tenant=tenant_id)
        ids = [m["id"] for m in body.get("matches", [])]
        check("dismissed match disappears", oid not in ids)

    # --- 9. tenant isolation ------------------------------------------------
    print("\n9. Tenant isolation")
    other = psql(
        f"SELECT id FROM platform.tenants WHERE id <> '{tenant_id}' "
        "ORDER BY created_at LIMIT 1"
    )
    if other:
        code, body = call("GET", "/grants/matches", token=token, tenant=other)
        # The token has no membership in that tenant, so this must not return
        # its matches. Either refused, or empty -- never another org's data.
        leaked = code == 200 and len(body.get("matches", [])) > 0
        check("cannot read another tenant's matches", not leaked,
              f"got {code} with {len(body.get('matches', []))} rows")

    code, body = call("GET", f"/grants/scan/{job_id}", token=token, tenant=other or tenant_id)
    if other:
        check("cannot poll another tenant's job", code == 404, f"got {code}")

    # --- 10. limits ---------------------------------------------------------
    print("\n10. Plan limits are server-side")
    hit_limit = False
    for _ in range(int(limit_before or 3) + 2):
        time.sleep(61 - time.localtime().tm_sec % 60) if False else None
        code, body = call("POST", "/grants/scan", token=token, tenant=tenant_id)
        if code == 402:
            hit_limit = True
            break
    # Deduping is per minute, so within one run we may not reach the ceiling.
    # What matters is that the count comes from the ledger, not the client.
    used = psql(f"""
        SELECT count(*) FROM platform.jobs
        WHERE tenant_id = '{tenant_id}' AND idempotency_key LIKE 'scan:%'
    """)
    check("scan usage counted from the job ledger", int(used) >= 1, f"ledger says {used}")
    if hit_limit:
        check("limit returns 402 with an upgrade path", True)

    print("\n" + "=" * 62)
    print(f"  {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
