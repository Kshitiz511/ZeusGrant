#!/usr/bin/env python3
"""Live check of the refresh-cookie session lifecycle against platform-core.

Proves the four properties that make "stay logged in" safe to ship:
rotation, CSRF enforcement, reuse detection, and clean logout.

    python3 scripts/e2e_sessions.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

# Default hits platform-core directly; point at http://localhost:5174/api/core
# to exercise the same nginx path the browser uses.
BASE = os.environ.get("ZEUS_BASE", "http://localhost:8000")

# Must match ZEUS_SESSION_REUSE_LEEWAY_SECONDS on the server. Within this
# window a re-presented token is treated as two tabs racing; beyond it, as
# theft. Set it lower on the server to keep this probe quick.
LEEWAY_SECONDS = int(os.environ.get("ZEUS_SESSION_REUSE_LEEWAY_SECONDS", "15"))


def expire_leeway() -> None:
    """Wait out the concurrent-refresh grace period.

    Reuse detection deliberately tolerates a replay that arrives within the
    leeway, so testing the theft path means genuinely letting that window
    close. Sleeping is the only honest way to do it from outside the process.
    """
    time.sleep(LEEWAY_SECONDS + 1)
EMAIL = f"session-probe-{int(time.time())}@example.com"
PASSWORD = "correct-horse-battery-staple"

passed = failed = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global passed, failed
    if ok:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label} {detail}")


class Client:
    """Minimal cookie-aware HTTP client — mirrors what a browser would do."""

    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar)
        )

    def cookie(self, name: str) -> str | None:
        for c in self.jar:
            if c.name == name:
                return c.value
        return None

    def post(self, path: str, body: dict | None = None, headers: dict | None = None):
        data = json.dumps(body).encode() if body is not None else b"{}"
        req = urllib.request.Request(
            BASE + path,
            data=data,
            headers={"content-type": "application/json", **(headers or {})},
            method="POST",
        )
        try:
            with self.opener.open(req) as res:
                raw = res.read()
                return res.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                return exc.code, json.loads(raw)
            except Exception:
                return exc.code, None

    def set_cookie_value(self, name: str, value: str) -> None:
        """Force a cookie back to an older value (simulates a stolen copy)."""
        for c in self.jar:
            if c.name == name:
                c.value = value


def main() -> int:
    print(f"Session lifecycle probe against {BASE}\n")
    client = Client()

    status, session = client.post(
        "/auth/signup", {"email": EMAIL, "password": PASSWORD, "workspace_name": "Probe"}
    )
    check("signup succeeds", status == 201, f"got {status} {session}")
    if status != 201:
        return 1

    first_cookie = client.cookie("zeus_session")
    first_csrf = client.cookie("zeus_csrf")
    check("signup sets an httpOnly session cookie", bool(first_cookie))
    check("signup sets a readable CSRF cookie", bool(first_csrf))
    check("csrf token is echoed in the body", session.get("csrf_token") == first_csrf)

    # --- CSRF is enforced ---------------------------------------------------
    status, _ = client.post("/auth/refresh")
    check("refresh without the CSRF header is rejected", status == 401, f"got {status}")

    status, _ = client.post("/auth/refresh", headers={"x-csrf-token": "wrong-value"})
    check("refresh with a bad CSRF header is rejected", status == 401, f"got {status}")

    # A failed CSRF check must not have burnt the session.
    status, refreshed = client.post("/auth/refresh", headers={"x-csrf-token": first_csrf})
    check("refresh with the CSRF header succeeds", status == 200, f"got {status}")
    check(
        "refresh returns a usable access token",
        bool(refreshed and refreshed.get("access_token")),
    )
    check(
        "refresh returns the same user",
        bool(refreshed) and refreshed["user_id"] == session["user_id"],
    )

    second_cookie = client.cookie("zeus_session")
    second_csrf = client.cookie("zeus_csrf")
    check("session cookie was rotated", second_cookie != first_cookie)
    check("csrf cookie was rotated", second_csrf != first_csrf)

    # --- Concurrent refresh (two tabs) is tolerated ------------------------
    # Both tabs hold the same cookie on load; this must not log anyone out.
    client.set_cookie_value("zeus_session", first_cookie)
    status, _ = client.post("/auth/refresh", headers={"x-csrf-token": first_csrf})
    check(
        "a second tab refreshing the same cookie still works",
        status == 200,
        f"got {status}",
    )
    third_cookie = client.cookie("zeus_session")
    third_csrf = client.cookie("zeus_csrf")

    # The successor from the first refresh must still be alive too.
    client.set_cookie_value("zeus_session", second_cookie)
    status, _ = client.post("/auth/refresh", headers={"x-csrf-token": second_csrf})
    check("the other tab's session survives", status == 200, f"got {status}")

    # --- Reuse detection (stale replay) ------------------------------------
    # Age the rotation past the leeway so this looks like a captured cookie
    # rather than a race.
    expire_leeway()
    client.set_cookie_value("zeus_session", third_cookie)
    status, _ = client.post("/auth/refresh", headers={"x-csrf-token": third_csrf})
    check("a stale replayed cookie is rejected", status == 401, f"got {status}")

    # ...and the replay must have killed the family, successors included.
    latest = client.cookie("zeus_session")
    status, _ = client.post("/auth/refresh", headers={"x-csrf-token": client.cookie("zeus_csrf")})
    check(
        "reuse detection revokes the whole family",
        status == 401,
        f"got {status} (cookie {latest!r})",
    )

    # --- Logout -------------------------------------------------------------
    fresh = Client()
    status, session2 = fresh.post("/auth/login", {"email": EMAIL, "password": PASSWORD})
    check("login after revocation still works", status == 200, f"got {status}")
    csrf2 = fresh.cookie("zeus_csrf")
    cookie2 = fresh.cookie("zeus_session")

    status, _ = fresh.post("/auth/logout")
    check("logout succeeds", status == 204, f"got {status}")

    fresh.set_cookie_value("zeus_session", cookie2)
    status, _ = fresh.post("/auth/refresh", headers={"x-csrf-token": csrf2})
    check("cookie cannot be replayed after logout", status == 401, f"got {status}")

    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
