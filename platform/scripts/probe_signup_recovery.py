#!/usr/bin/env python3
"""Can a user whose verification email failed to send ever sign up again?

Found during the grants end-to-end run: signup returned 502 while the user row
was created. If the retry is refused as a duplicate, that address is stranded --
the account exists, cannot be verified, and cannot be recreated.
"""

from __future__ import annotations

import contextlib
import json
import subprocess
import time
import urllib.error
import urllib.request

BASE = "http://localhost:8000"
EMAIL = f"stranded-{int(time.time())}@example.com"
BODY = {"email": EMAIL, "password": "Test-Passw0rd-x", "full_name": "Test"}


def post(path: str, body: dict) -> tuple[int, str]:
    req = urllib.request.Request(
        f"{BASE}{path}", method="POST",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode()[:300]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def psql(sql: str) -> str:
    out = subprocess.run(
        ["docker", "exec", "zeus-platform-postgres-1", "psql", "-U", "zeus",
         "-d", "zeus", "-t", "-A", "-c", sql],
        capture_output=True, text=True, timeout=30,
    )
    return out.stdout.strip()


print(f"Address: {EMAIL}\n")

code, body = post("/auth/signup", BODY)
print(f"1st signup      -> {code}")
print(f"   {body[:180]}")

exists = psql(f"SELECT count(*) FROM platform.users WHERE email = '{EMAIL}'")
print(f"   user row created: {exists}")

code2, body2 = post("/auth/signup", BODY)
print(f"\n2nd signup      -> {code2}")
print(f"   {body2[:180]}")

code3, body3 = post("/auth/login", {"email": EMAIL, "password": BODY["password"]})
print(f"\nlogin           -> {code3}")
print(f"   {body3[:180]}")

# The 403 carries a user_id, and the signup error names "Resend code" as the
# way out. Test that route rather than concluding from the 400 alone -- the
# first reading of this probe called the account stranded without checking the
# recovery path the error message points at.
user_id = ""
with contextlib.suppress(ValueError, AttributeError):
    user_id = json.loads(body3).get("detail", {}).get("user_id", "")

code4, body4 = (0, "")
if user_id:
    code4, body4 = post("/auth/verify/resend", {"user_id": user_id})
    print(f"\nresend code     -> {code4}")
    print(f"   {body4[:180]}")

print("\n--- reading ---")
if exists != "1":
    print("No user row was left behind, so the address is still free.")
elif code2 in (200, 202):
    print("RECOVERABLE via signup: signing up again re-sends the code.")
elif user_id and code4 in (200, 202, 204):
    print("RECOVERABLE via resend. Signing up again is refused, but the login")
    print("403 returns a user_id and resend accepts it, so the user can get a")
    print("fresh code. The path exists; it depends on the client following the")
    print("403 rather than showing a dead end.")
else:
    print("STRANDED: the account exists, the email never arrived, signup is")
    print(f"refused, and resend returned {code4}. No route forward.")
