#!/usr/bin/env python
"""Why is Resend rejecting production sends? (Q9)

Read-only. Lists the domains on the Resend account and their verification
state, and reports which sender address production is configured to use.
Resend refuses to send from a domain it has not verified, and an unverified
account can only deliver to its own owner's address -- so the answer to Q9 is
almost always visible from these two facts without sending anything.

Sending a test message is deliberately not done here: it would land in a real
inbox and count against the account's quota, and the diagnosis does not need it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _dsn import env_value  # noqa: E402


def main() -> int:
    key = env_value("ZEUS_RESEND_API_KEY")
    sender = env_value("ZEUS_EMAIL_FROM")
    print(f"sender configured: {sender or '(not set)'}")
    if not key:
        print("ZEUS_RESEND_API_KEY is not set; nothing to check.")
        return 1

    r = httpx.get(
        "https://api.resend.com/domains",
        headers={"Authorization": f"Bearer {key}"},
        timeout=20,
    )
    print(f"GET /domains -> {r.status_code}")
    if r.status_code != 200:
        # A restricted "sending access" key cannot list domains. That is itself
        # a finding, not a failure of this script.
        print(r.text[:400])
        return 1

    domains = r.json().get("data", [])
    if not domains:
        print("No domains on this Resend account.")
    for d in domains:
        print(f"  {d.get('name'):30} status={d.get('status')}  region={d.get('region')}")

    sender_domain = sender.split("@")[-1].strip(">").lower() if sender and "@" in sender else ""
    verified = {d.get("name", "").lower() for d in domains if d.get("status") == "verified"}
    if sender_domain == "resend.dev":
        print("\nDIAGNOSIS: sending from resend.dev, Resend's shared test domain.")
        print("It only delivers to the address that owns the Resend account.")
    elif sender_domain and sender_domain not in verified:
        print(f"\nDIAGNOSIS: sender domain {sender_domain!r} is not verified on this account.")
    elif sender_domain:
        print(f"\nSender domain {sender_domain!r} is verified. Q9 is something else.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
