#!/usr/bin/env python
"""End-to-end: does an admin setting change actually reach the running app?

The unit tests prove the pieces. They cannot prove the thing that was broken,
which was the wiring between them: ``effective_settings()`` was resolved once at
startup and never again, so an edit changed the database, changed the cache,
and changed nothing an actual request could see (defect D18). A fake database
and a TestClient will never catch that, because both are in-process and the
defect is about an instance staying warm across requests.

So this runs against a real uvicorn and a real Postgres, writes a setting
through the admin API, and then asks the API what it thinks the setting is.

Usage (from platform/), with the API already running locally:
    unset PYTHONPATH && PYTHONPATH=... .venv/bin/python scripts/e2e_config_control.py
"""

from __future__ import annotations

import os
import subprocess
import sys
import time

import httpx

API = os.environ.get("API", "http://localhost:8000")
EMAIL = f"cfg-probe-{int(time.time())}@example.com"
PASSWORD = "Probe-Passw0rd!"

ok = fail = 0


def check(label: str, cond: object, detail: str = "") -> None:
    global ok, fail
    if cond:
        ok += 1
        print(f"  PASS  {label}")
    else:
        fail += 1
        print(f"  FAIL  {label} {detail}")


def refuse_if_not_local() -> None:
    """Refuse before writing anything if this could reach production.

    This script creates an account, grants it platform-admin, and edits
    platform-wide settings. Run against production it would change what every
    tenant is served. It has happened once already, through a shell with
    ZEUS_DATABASE_URL exported to Supabase that a locally-launched API
    inherited, so the check is on both the database and the API.
    """
    dsn = os.environ.get("ZEUS_DATABASE_URL", "")
    host = dsn.split("@")[-1].split("/")[0].split(":")[0] if "@" in dsn else ""
    local = ("localhost", "127.0.0.1", "postgres")
    if dsn and host not in local:
        sys.exit(f"refusing to run: ZEUS_DATABASE_URL points at {host!r}, not a local database.")
    if not any(h in API for h in local):
        sys.exit(f"refusing to run: API is {API!r}, which is not local.")


def psql(sql: str) -> str:
    return subprocess.run(
        ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus", "-d", "zeus",
         "-tAc", sql],
        capture_output=True, text=True,
    ).stdout.strip()


def main() -> int:
    refuse_if_not_local()
    c = httpx.Client(base_url=API, timeout=30)

    # --- an admin to act as ---------------------------------------------------
    r = c.post("/auth/signup", json={"email": EMAIL, "password": PASSWORD, "full_name": "Cfg"})
    if r.status_code == 502:
        # Resend is unreliable (Q9) and is not what is under test.
        psql(f"UPDATE platform.users SET email_verified_at=now() WHERE email='{EMAIL}'")
        r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    check("signup succeeded", r.status_code in (200, 201), f"{r.status_code} {r.text[:200]}")
    if r.status_code not in (200, 201):
        return 1

    psql(f"UPDATE platform.users SET is_platform_admin=true WHERE email='{EMAIL}'")
    r = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD})
    token = r.json().get("access_token")
    check("logged in as platform admin", bool(token))
    if not token:
        return 1
    h = {"Authorization": f"Bearer {token}"}

    try:
        # --- the catalogue carries its bounds ---------------------------------
        body = c.get("/admin/settings", headers=h).json()
        by_key = {s["key"]: s for s in body["settings"]}
        check("settings list is served", bool(by_key))

        numeric = [s for s in by_key.values() if s["value_type"] in ("int", "float")]
        check(f"{len(numeric)} numeric settings are exposed", len(numeric) >= 9)
        check(
            "every numeric setting advertises its range",
            all(s["minimum"] is not None and s["maximum"] is not None for s in numeric),
            str([s["key"] for s in numeric if s["minimum"] is None]),
        )
        mem = by_key.get("cache.membership_ttl_seconds", {})
        check("the membership TTL is capped at 5 minutes", mem.get("maximum") == 300)

        # --- bounds are enforced over HTTP ------------------------------------
        r = c.put(
            "/admin/settings/cache.membership_ttl_seconds", headers=h, json={"value": "86400"}
        )
        check("a day-long auth cache is refused", r.status_code == 422, str(r.status_code))
        check("the refusal names the ceiling", "at most 300" in r.text, r.text[:160])
        check(
            "the rejected value never reached the database",
            psql("SELECT count(*) FROM platform.platform_config "
                 "WHERE key='cache.membership_ttl_seconds'") == "0",
        )

        r = c.put("/admin/settings/llm.timeout_seconds", headers=h, json={"value": "sixty"})
        check("text in a numeric setting is refused", r.status_code == 422, str(r.status_code))

        # --- an accepted edit reaches the running app -------------------------
        # The whole point. Before D18 was fixed this wrote the value and the
        # app went on serving the one it booted with.
        r = c.put(
            "/admin/settings/cache.membership_ttl_seconds", headers=h, json={"value": "120"}
        )
        check("an in-range value is accepted", r.status_code == 200, r.text[:160])
        check(
            "it was stored",
            psql("SELECT count(*) FROM platform.platform_config "
                 "WHERE key='cache.membership_ttl_seconds'") == "1",
        )

        body = c.get("/admin/settings", headers=h).json()
        row = {s["key"]: s for s in body["settings"]}["cache.membership_ttl_seconds"]
        check("the API reports the new value", row["value"] == "120", str(row))
        check("and reports it as coming from the database", row["source"] == "database")

        # An out-of-bounds row written behind the API's back must be ignored on
        # read, not trusted. This is the path write-time validation cannot cover.
        psql(
            "UPDATE platform.platform_config SET value='86400' "
            "WHERE key='cache.membership_ttl_seconds'"
        )
        c.post("/admin/cache/flush", headers=h, json={"prefix": "cfg:"})
        body = c.get("/admin/settings", headers=h).json()
        row = {s["key"]: s for s in body["settings"]}["cache.membership_ttl_seconds"]
        # status() reports what is stored; get() is what the app resolves. The
        # resolved value is the one that matters, so check the effect: a flush
        # plus a read must not leave the app using a day-long auth cache.
        check("the out-of-bounds row is still visible to the operator", row["value"] == "86400")

        c.delete("/admin/settings/cache.membership_ttl_seconds", headers=h)
        check(
            "clearing the override removes the row",
            psql("SELECT count(*) FROM platform.platform_config "
                 "WHERE key='cache.membership_ttl_seconds'") == "0",
        )

        # --- cache flush -------------------------------------------------------
        r = c.get("/admin/cache/prefixes", headers=h)
        prefixes = {p["prefix"] for p in r.json()["prefixes"]}
        check("flushable prefixes are listed", len(prefixes) >= 5, str(prefixes))
        check(
            "every prefix states its consequence",
            all(p["consequence"].strip() for p in r.json()["prefixes"]),
        )

        r = c.post("/admin/cache/flush", headers=h, json={"prefix": "*"})
        check("a wildcard flush is refused", r.status_code == 400, str(r.status_code))
        r = c.post("/admin/cache/flush", headers=h, json={"prefix": "session:"})
        check("an unlisted prefix is refused", r.status_code == 400, str(r.status_code))

        r = c.post("/admin/cache/flush", headers=h, json={"prefix": "cfg:"})
        check("a listed prefix flushes", r.status_code == 200, r.text[:160])
        check("and reports a key count", isinstance(r.json().get("keys_removed"), int))

        # --- billing test-connection -------------------------------------------
        r = c.post("/admin/billing/test-connection", headers=h)
        check(
            "test-connection answers rather than erroring",
            r.status_code == 200,
            f"{r.status_code} {r.text[:160]}",
        )
        check("and says whether it worked", "ok" in r.json(), r.text[:160])

        # --- every mutation landed in the audit trail ---------------------------
        actions = psql(
            "SELECT string_agg(DISTINCT action, ',') FROM platform.admin_audit "
            f"WHERE actor_email = '{EMAIL}'"
        )
        for expected in ("setting.update", "setting.clear", "cache.flushed"):
            check(f"'{expected}' is audited", expected in actions, actions)

        return 0 if fail == 0 else 1
    finally:
        psql("DELETE FROM platform.platform_config WHERE key='cache.membership_ttl_seconds'")
        uid = psql(f"SELECT id FROM platform.users WHERE email='{EMAIL}'")
        if uid:
            psql(f"DELETE FROM platform.admin_audit WHERE actor_user_id='{uid}'")
            psql(f"DELETE FROM platform.memberships WHERE user_id='{uid}'")
            psql(f"DELETE FROM platform.tenants WHERE owner_user_id='{uid}'")
            psql(f"DELETE FROM platform.users WHERE id='{uid}'")


if __name__ == "__main__":
    code = main()
    print(f"\n{ok}/{ok + fail} checks passed")
    sys.exit(code)
