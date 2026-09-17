#!/usr/bin/env python
"""End-to-end: suspend a real tenant and prove it actually loses access.

Run against a locally running API and database. The unit tests use a fake
database and the schema probe never goes through HTTP, so neither of them can
tell you whether suspension survives the round trip: status write -> cache
invalidation -> recompute -> the next request being refused. That round trip is
the whole feature, and it is where the 300-second entitlements TTL will bite if
the route forgets to invalidate.

Usage (from platform/, with the API running on :8000):
    unset PYTHONPATH && PYTHONPATH=... .venv/bin/python scripts/e2e_tenant_suspension.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

import httpx

API = os.environ.get("API", "http://localhost:8000")
DSN = os.environ.get("ZEUS_DATABASE_URL", "postgresql://zeus:zeus@localhost:5433/zeus")
EMAIL = f"suspend-probe-{int(time.time())}@example.com"
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


def psql(sql: str) -> str:
    res = subprocess.run(
        ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus", "-d", "zeus",
         "-At", "-c", sql],
        capture_output=True,
        text=True,
    )
    return res.stdout.strip()


LOCAL_HOSTS = ("localhost", "127.0.0.1", "postgres")


def override_count(tenant_id: str) -> str:
    return psql(
        "SELECT count(*) FROM platform.tenant_limit_overrides "
        f"WHERE tenant_id='{tenant_id}'"
    )


def refuse_if_not_local() -> None:
    """Abort before writing anything if this could reach a real database.

    This is not hypothetical. This script creates accounts and suspends
    tenants; run against production it would create a junk user and could
    suspend a paying customer. It has already happened once: a shell had
    ZEUS_DATABASE_URL exported to Supabase, the locally-launched API inherited
    it, and a probe account was created in production before anything failed.

    Detecting the mistake afterwards is not good enough, because by then the
    write has happened. So this runs first and refuses outright.

    Note what it cannot check: whether the *server* on ``API`` shares this
    environment. That is why it also insists the API is on localhost -- a
    remote API is one this script has no business writing to at all.
    """
    dsn = os.environ.get("ZEUS_DATABASE_URL", "")
    host = dsn.split("@")[-1].split("/")[0].split(":")[0] if "@" in dsn else ""
    if dsn and host not in LOCAL_HOSTS:
        sys.exit(
            f"refusing to run: ZEUS_DATABASE_URL points at {host!r}, not a local database.\n"
            f"  This script creates accounts and suspends tenants.\n"
            f"  Run it with the variable unset, or set to the local DSN."
        )
    if not any(h in API for h in LOCAL_HOSTS):
        sys.exit(f"refusing to run: API is {API!r}, which is not local.")
    if psql("SELECT 1") != "1":
        sys.exit(
            "refusing to run: the local Postgres container is not reachable.\n"
            "  Start it with: docker compose up -d postgres"
        )


def main() -> int:
    refuse_if_not_local()
    c = httpx.Client(base_url=API, timeout=30)

    r = c.post(
        "/auth/signup",
        json={"email": EMAIL, "password": PASSWORD, "full_name": "Suspend Probe"},
    )
    # 502 = the account exists but the verification email could not be sent
    # (Q9, Resend). Not what is under test, so verify directly and continue.
    if r.status_code == 502:
        psql(f"UPDATE platform.users SET email_verified_at=now() WHERE email='{EMAIL}'")
        print("  note: verification email could not be sent (Q9); verified directly.")
        r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    check("signup succeeded", r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    if r.status_code not in (200, 201):
        return 1

    user_auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

    tenant_id = psql(
        f"SELECT t.id FROM platform.tenants t JOIN platform.users u "
        f"ON u.id = t.owner_user_id WHERE u.email = '{EMAIL}' LIMIT 1"
    )
    check("signup created a tenant", bool(tenant_id), tenant_id)
    if not tenant_id:
        return 1

    # The user can exchange for a tenant-scoped token while active.
    r = c.post("/tenancy/token", json={"tenant_id": tenant_id}, headers=user_auth)
    check(
        "an active tenant can be entered",
        r.status_code == 200,
        f"{r.status_code} {r.text[:200]}",
    )

    env = {**os.environ, "ZEUS_DATABASE_URL": DSN}
    subprocess.run(
        [sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--yes"],
        capture_output=True, text=True, env=env,
    )
    r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    admin_auth = {"Authorization": f"Bearer {r.json()['access_token']}"}

    # --- the operator's view ------------------------------------------------
    r = c.get("/admin/tenants", headers=admin_auth)
    check("the tenant list loads", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    listed = r.json().get("tenants", []) if r.status_code == 200 else []
    check("the new tenant appears in the list", any(t["id"] == tenant_id for t in listed))
    check(
        "the list reports a total for pagination",
        "total" in (r.json() if r.status_code == 200 else {}),
    )

    r = c.get(f"/admin/tenants/{tenant_id}", headers=admin_auth)
    check("the tenant detail loads", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        detail = r.json()
        check("detail includes members", any(m["email"] == EMAIL for m in detail["members"]))
        check("detail reports the tenant as active", detail["tenant"]["status"] == "active")

    # --- suspend -------------------------------------------------------------
    r = c.post(
        f"/admin/tenants/{tenant_id}/status",
        json={"status": "suspended", "reason": "e2e probe"},
        headers=admin_auth,
    )
    check("suspension succeeded", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    if r.status_code == 200:
        check("suspension reports the previous status", r.json()["previous_status"] == "active")
        check("a suspended tenant has no active modules", r.json()["active_modules"] == [])

    check(
        "the status is persisted, not just returned",
        psql(f"SELECT status FROM platform.tenants WHERE id='{tenant_id}'") == "suspended",
    )

    # The point of the whole exercise: it bites now, not in five minutes.
    r = c.post("/tenancy/token", json={"tenant_id": tenant_id}, headers=user_auth)
    check(
        "a suspended tenant cannot be entered (no TTL wait)",
        r.status_code in (403, 404),
        f"{r.status_code} {r.text[:200]}",
    )

    check(
        "the suspension is in the audit trail",
        any(
            e["action"] == "tenant.status.set" and e.get("target_id") == tenant_id
            for e in c.get("/admin/audit", headers=admin_auth).json().get("entries", [])
        ),
    )

    # --- reactivate ----------------------------------------------------------
    r = c.post(
        f"/admin/tenants/{tenant_id}/status",
        json={"status": "active", "reason": "e2e probe done"},
        headers=admin_auth,
    )
    check("reactivation succeeded", r.status_code == 200, f"{r.status_code} {r.text[:200]}")

    r = c.post("/tenancy/token", json={"tenant_id": tenant_id}, headers=user_auth)
    check(
        "a reactivated tenant can be entered again",
        r.status_code == 200,
        f"{r.status_code} {r.text[:200]}",
    )

    # --- limit overrides ------------------------------------------------------
    r = c.get(f"/admin/tenants/{tenant_id}/limits", headers=admin_auth)
    check("the limits view loads", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    keys = r.json().get("available_keys", []) if r.status_code == 200 else []
    check("there is at least one overridable limit key", bool(keys), str(keys))

    if keys:
        key = keys[0]
        r = c.put(
            f"/admin/tenants/{tenant_id}/limits/{key}",
            json={"limit_value": 4242, "reason": "e2e probe"},
            headers=admin_auth,
        )
        check("an override can be set", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        check(
            "the override is persisted",
            psql(
                f"SELECT limit_value FROM platform.tenant_limit_overrides "
                f"WHERE tenant_id='{tenant_id}' AND limit_key='{key}'"
            ) == "4242",
        )

        r = c.put(
            f"/admin/tenants/{tenant_id}/limits/{key}",
            json={"limit_value": 1, "reason": "no reason given"},
            headers=admin_auth,
        )
        check(
            "setting the same key again updates rather than duplicates",
            override_count(tenant_id) == "1",
        )

        r = c.put(
            f"/admin/tenants/{tenant_id}/limits/definitely_not_a_real_key",
            json={"limit_value": 1, "reason": "typo"},
            headers=admin_auth,
        )
        check("an unknown limit key is refused", r.status_code == 400, str(r.status_code))

        r = c.delete(f"/admin/tenants/{tenant_id}/limits/{key}", headers=admin_auth)
        check("an override can be cleared", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
        check(
            "clearing removes the row",
            override_count(tenant_id) == "0",
        )

        r = c.delete(f"/admin/tenants/{tenant_id}/limits/{key}", headers=admin_auth)
        check("clearing a missing override 404s rather than claiming success",
              r.status_code == 404, str(r.status_code))

    # --- a non-operator cannot do any of this ---------------------------------
    subprocess.run(
        [sys.executable, "scripts/grant_platform_admin.py", EMAIL, "--revoke", "--yes"],
        capture_output=True, text=True, env=env,
    )
    r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    revoked = {"Authorization": f"Bearer {r.json()['access_token']}"}
    r = c.post(
        f"/admin/tenants/{tenant_id}/status",
        json={"status": "suspended", "reason": "should not work"},
        headers=revoked,
    )
    check("a revoked operator cannot suspend a tenant", r.status_code == 403, str(r.status_code))
    check(
        "and the tenant is genuinely untouched",
        psql(f"SELECT status FROM platform.tenants WHERE id='{tenant_id}'") == "active",
    )

    print(f"\n{ok} passed, {fail} failed")
    return 1 if fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
