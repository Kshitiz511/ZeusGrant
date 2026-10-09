#!/usr/bin/env python
"""End-to-end: the operator console's data path.

The admin endpoints have been tested since Phase 4. What has not been tested
is the *contract between them and the console*: the TypeScript types in
``apps/console/src/lib/admin-api.ts`` were written by reading the Python, not
by observing a payload, and a field renamed on either side would surface as an
empty table rather than an error.

So this probe asserts the exact keys the console reads. ``tenants`` is not
enough -- the list header shows ``total``, the plans screen keys off
``unsellable_active_plans``, and the models screen exists almost entirely to
display ``unpriced_models``. If any of those vanish the console degrades
silently, which is the failure mode worth a probe.

Local only. It creates an account and grants it platform-admin rights.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import LOCAL_DSN, host_of, is_local  # noqa: E402

API = os.environ.get("API", "http://localhost:8000")
DSN = os.environ.get("ZEUS_DATABASE_URL", LOCAL_DSN)
EMAIL = f"phase8-probe-{int(time.time())}@example.com"
PLAIN = f"phase8-plain-{int(time.time())}@example.com"
PASSWORD = "Probe-Passw0rd!"

ok = fail = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label} {detail}")


def keys_present(label: str, body: object, *keys: str) -> None:
    """Assert a response carries every key the console reads off it."""
    if not isinstance(body, dict):
        check(label, False, f"expected an object, got {type(body).__name__}")
        return
    missing = [k for k in keys if k not in body]
    check(label, not missing, f"missing {missing}")


def signup(c: httpx.Client, email: str) -> str:
    """An account with a verified address, returning a bearer token."""
    r = c.post("/auth/signup", json={"email": email, "password": PASSWORD, "full_name": "Probe"})
    # 502 means the account exists but the verification mail could not be sent
    # (Q9). That is not what this probe is testing, so verify directly.
    # 202 = sent but unverified (console mailer). Either way, verify directly.
    if r.status_code in (202, 502):
        subprocess.run(
            ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus", "-d", "zeus",
             "-c", f"UPDATE platform.users SET email_verified_at=now() WHERE email='{email}'"],
            capture_output=True, text=True,
        )
        r = c.post("/auth/login", json={"email": email, "password": PASSWORD})
    if r.status_code not in (200, 201):
        sys.exit(f"signup failed for {email}: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def tenant_token(c: httpx.Client, token: str) -> tuple[str, str]:
    """Exchange a session token for a tenant-scoped one, as the console does."""
    auth = {"Authorization": f"Bearer {token}"}
    r = c.get("/tenancy/mine", headers=auth)
    if r.status_code != 200 or not r.json():
        sys.exit(f"no tenants for this account: {r.status_code} {r.text[:200]}")
    tenant_id = r.json()[0]["tenant_id"]
    r = c.post("/tenancy/token", json={"tenant_id": tenant_id}, headers=auth)
    if r.status_code != 200:
        sys.exit(f"token exchange failed: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"], tenant_id


def main() -> int:
    if not is_local(DSN):
        sys.exit(
            f"refusing to run: ZEUS_DATABASE_URL points at {host_of(DSN)}, not local."
        )
    if not any(h in API for h in ("localhost", "127.0.0.1")):
        sys.exit(f"refusing to run: API is {API!r}, which is not local.")
    print(f"target: local  {host_of(DSN)}  (operator console contract)", file=sys.stderr)

    c = httpx.Client(base_url=API, timeout=30)
    env = {**os.environ, "ZEUS_DATABASE_URL": DSN}

    # --- a plain tenant user must not be told they are an operator ----------
    plain_tok, _ = tenant_token(c, signup(c, PLAIN))
    plain_auth = {"Authorization": f"Bearer {plain_tok}"}
    r = c.get("/tenancy/me", headers=plain_auth)
    check("/tenancy/me answers for an ordinary user", r.status_code == 200, str(r.status_code))
    body = r.json()
    keys_present("/tenancy/me carries the keys the shell reads", body, "role", "platform_admin")
    check("an ordinary user is not a platform admin", body.get("platform_admin") is False,
          repr(body.get("platform_admin")))
    # The sidebar hides the console on this flag; the server must still refuse.
    r = c.get("/admin/tenants", headers=plain_auth)
    check("an ordinary user is refused by the admin API", r.status_code == 403, str(r.status_code))

    # --- grant, then re-login so the flag reaches a fresh token -------------
    token = signup(c, EMAIL)
    res = subprocess.run([sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--yes"],
                         capture_output=True, text=True, env=env)
    check("grant succeeded", res.returncode == 0, res.stdout + res.stderr)

    login = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    token = login.json()["access_token"]
    admin_tok, tenant_id = tenant_token(c, token)
    auth = {"Authorization": f"Bearer {admin_tok}"}

    r = c.get("/tenancy/me", headers=auth)
    check("the operator is reported as a platform admin",
          r.json().get("platform_admin") is True, r.text[:200])
    # Membership role and platform-admin are separate grants. If the console
    # derived one from the other it would show the console to every owner.
    check("the operator is still just an owner of their own workspace",
          r.json().get("role") == "owner", repr(r.json().get("role")))

    # --- every section the console renders ---------------------------------
    r = c.get("/admin/tenants", headers=auth)
    check("tenants: 200", r.status_code == 200, r.text[:200])
    keys_present("tenants: list header fields", r.json(), "tenants", "total", "limit", "offset")
    tenants = r.json()["tenants"]
    check("tenants: at least the probe's own workspaces", len(tenants) >= 2, str(len(tenants)))
    if tenants:
        keys_present("tenants: row fields the table shows", tenants[0],
                     "id", "name", "slug", "status")

    r = c.get(f"/admin/tenants/{tenant_id}", headers=auth)
    check("tenant detail: 200", r.status_code == 200, r.text[:200])
    keys_present("tenant detail: panes the console renders", r.json(),
                 "tenant", "members", "subscriptions", "limit_overrides", "entitlements")

    r = c.get("/admin/plans", headers=auth)
    check("plans: 200", r.status_code == 200, r.text[:200])
    keys_present("plans: catalogue plus the unsellable warning", r.json(),
                 "plans", "unsellable_active_plans")
    if r.json()["plans"]:
        keys_present("plans: row fields the table shows", r.json()["plans"][0],
                     "plan_id", "module_id", "name", "monthly_cents",
                     "stripe_price_id_monthly", "is_active")

    r = c.get("/admin/models", headers=auth)
    check("models: 200", r.status_code == 200, r.text[:200])
    keys_present("models: prices plus the unpriced warning", r.json(),
                 "models", "unpriced_models")

    r = c.get("/admin/jobs", headers=auth)
    check("jobs: 200", r.status_code == 200, r.text[:200])
    keys_present("jobs: list header fields", r.json(), "jobs", "total")

    r = c.get("/admin/jobs/health", headers=auth)
    check("queue health: 200", r.status_code == 200, r.text[:200])

    r = c.get("/admin/settings", headers=auth)
    check("settings: 200", r.status_code == 200, r.text[:200])
    settings = r.json().get("settings", [])
    check("settings: not empty", len(settings) > 0, str(len(settings)))
    if settings:
        keys_present("settings: fields the config screen renders", settings[0],
                     "key", "label", "group", "is_secret", "source", "value",
                     "value_type", "minimum", "maximum")

    r = c.get("/admin/audit", headers=auth)
    check("audit: 200", r.status_code == 200, r.text[:200])
    keys_present("audit: entries", r.json(), "entries")

    # --- a destructive action, and the audit row it must leave --------------
    plain_tenant = next((t for t in tenants if t["id"] != tenant_id), None)
    if plain_tenant:
        r = c.post(f"/admin/tenants/{plain_tenant['id']}/status",
                   json={"status": "suspended", "reason": "phase 8 probe"}, headers=auth)
        check("suspend succeeded", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

        r = c.get(f"/admin/tenants/{plain_tenant['id']}", headers=auth)
        check("the tenant now reads as suspended",
              r.json()["tenant"]["status"] == "suspended", r.json()["tenant"]["status"])

        # A reason is mandatory in the console precisely because it is what the
        # audit row carries. A trail of unexplained suspensions is barely a
        # trail, so assert the reason actually arrives.
        #
        # The action is matched exactly rather than by substring: a probe that
        # accepted anything containing "tenant" would pass against the wrong
        # row and report an audit trail that does not exist.
        entries = c.get("/admin/audit", headers=auth).json()["entries"]
        suspension = next((e for e in entries if e["action"] == "tenant.status.set"), None)
        check("the suspension was audited", suspension is not None,
              str(sorted({e["action"] for e in entries})[:6]))
        if suspension:
            # The console renders actor_email, target_type/target_id and
            # before/after. It originally declared `target` and `detail`,
            # neither of which exists, and rendered a dash in every column --
            # a table of actions with no actor and no change, which looks like
            # a working audit trail until someone needs it. Hence exact keys.
            keys_present("audit row: fields the audit screen renders", suspension,
                         "id", "actor_email", "action", "target_type", "target_id",
                         "before", "after", "created_at")
            check("the audit row names the operator",
                  suspension.get("actor_email") == EMAIL, repr(suspension.get("actor_email")))
            check("the audit row carries the operator's reason",
                  "phase 8 probe" in str(suspension.get("after")),
                  str(suspension.get("after"))[:200])
            check("the audit row records what the status was before",
                  "active" in str(suspension.get("before")),
                  str(suspension.get("before"))[:200])

        r = c.post(f"/admin/tenants/{plain_tenant['id']}/status",
                   json={"status": "active", "reason": "phase 8 probe cleanup"}, headers=auth)
        check("restore succeeded", r.status_code == 200, str(r.status_code))

    # A reason is required, not optional. The console disables the button, but
    # the server is what makes that a rule rather than a suggestion.
    r = c.post(f"/admin/tenants/{tenant_id}/status",
               json={"status": "suspended", "reason": ""}, headers=auth)
    check("suspension without a reason is refused", r.status_code == 422, str(r.status_code))

    subprocess.run([sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--revoke", "--yes"],
                   capture_output=True, text=True, env=env)
    token = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD}).json()[
        "access_token"
    ]
    revoked_tok, _ = tenant_token(c, token)
    r = c.get("/tenancy/me", headers={"Authorization": f"Bearer {revoked_tok}"})
    check("a revoked operator stops being reported as one",
          r.json().get("platform_admin") is False, repr(r.json().get("platform_admin")))

    print(f"\n{ok} passed, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
