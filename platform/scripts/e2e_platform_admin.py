#!/usr/bin/env python
"""End-to-end: sign up, confirm the admin API refuses, grant, confirm it allows.

Run against a locally running API and database. Proves the whole loop rather
than its parts: the flag in the database has to reach a minted token, and the
guard has to honour it.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

import httpx

API = os.environ.get("API", "http://localhost:8000")
DSN = os.environ.get("ZEUS_DATABASE_URL", "postgresql://zeus:zeus@localhost:5433/zeus")
EMAIL = f"admin-probe-{int(time.time())}@example.com"
PASSWORD = "Probe-Passw0rd!"

ok = fail = 0


def check(label, cond, detail=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label} {detail}")


def main() -> int:
    # Refuse before writing anything if this could reach a real database. This
    # script creates accounts and grants platform-admin rights; run against
    # production it would leave a junk operator behind. It has happened once
    # already, via a shell with ZEUS_DATABASE_URL exported to Supabase that a
    # locally-launched API inherited. Detecting it afterwards is too late.
    dsn = os.environ.get("ZEUS_DATABASE_URL", "")
    host = dsn.split("@")[-1].split("/")[0].split(":")[0] if "@" in dsn else ""
    local = ("localhost", "127.0.0.1", "postgres")
    if dsn and host not in local:
        sys.exit(
            f"refusing to run: ZEUS_DATABASE_URL points at {host!r}, not a local database."
        )
    if not any(h in API for h in local):
        sys.exit(f"refusing to run: API is {API!r}, which is not local.")

    c = httpx.Client(base_url=API, timeout=30)

    r = c.post(
        "/auth/signup",
        json={"email": EMAIL, "password": PASSWORD, "full_name": "Admin Probe"},
    )
    # 502 means the account exists but the verification email could not be sent
    # (Q9 -- Resend is unreliable). That is not the thing under test here, so
    # the account is verified directly and the probe carries on. If signup
    # itself failed, nothing below would be meaningful.
    if r.status_code == 502:
        subprocess.run(
            ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus", "-d", "zeus",
             "-c", f"UPDATE platform.users SET email_verified_at=now() WHERE email='{EMAIL}'"],
            capture_output=True, text=True,
        )
        print("  note: verification email could not be sent (Q9); verified directly.")
        r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    check("signup succeeded", r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    if r.status_code not in (200, 201):
        return 1
    token = r.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    # A brand-new account must not be an operator.
    r = c.get("/admin/settings", headers=auth)
    check("new account is refused by the admin API", r.status_code == 403, str(r.status_code))

    env = {**os.environ, "ZEUS_DATABASE_URL": DSN}
    res = subprocess.run(
        [sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--yes"],
        capture_output=True, text=True, env=env,
    )
    check("grant script succeeded", res.returncode == 0, res.stdout + res.stderr)

    # The old token predates the grant and must not gain power retroactively.
    r = c.get("/admin/settings", headers=auth)
    check("the pre-grant token is still refused", r.status_code == 403, str(r.status_code))

    # A fresh login re-reads the flag.
    r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    check("re-login succeeded", r.status_code == 200, str(r.status_code))
    new_auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = c.get("/admin/settings", headers=new_auth)
    check(
        "the post-grant token is allowed",
        r.status_code == 200,
        f"{r.status_code} {r.text[:200]}",
    )

    # A real mutation, and its audit row.
    r = c.post("/admin/prompts", json={"name": "probe.prompt", "body": "hello"}, headers=new_auth)
    check("admin mutation succeeded", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    r = c.get("/admin/audit", headers=new_auth)
    entries = r.json().get("entries", []) if r.status_code == 200 else []
    check("the mutation was audited", any(e["action"] == "prompt.add_version" for e in entries))
    check(
        "the audit row names the operator",
        any(e.get("actor_email") == EMAIL for e in entries),
        str([e.get("actor_email") for e in entries[:3]]),
    )

    subprocess.run(
        [sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--revoke", "--yes"],
        capture_output=True, text=True, env=env,
    )
    r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    revoked = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = c.get("/admin/settings", headers=revoked)
    check("a revoked account is refused again", r.status_code == 403, str(r.status_code))

    print(f"\n{ok} passed, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
