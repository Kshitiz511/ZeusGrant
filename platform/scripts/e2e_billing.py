#!/usr/bin/env python3
"""Smoke test for the billing endpoints against the live stack.

Covers the paths that do not require real Stripe credentials: the plan catalog,
and the two refusals that protect a customer from being charged for something
we cannot grant.

Usage: python3 scripts/e2e_billing.py
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

CORE = "http://localhost:8000"


def call(url, method="GET", token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:300]


def check(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")


print("== Signing up a tenant")
_, signup = call(
    f"{CORE}/auth/signup",
    "POST",
    body={
        "email": f"billing-e2e-{int(time.time())}@example.com",
        "password": "Sup3rSecret!pass",
        "workspace_name": "Billing E2E",
    },
)
tenant_id = signup["tenants"][0]["tenant_id"]
_, token_body = call(
    f"{CORE}/tenancy/token", "POST", token=signup["access_token"], body={"tenant_id": tenant_id}
)
TOKEN = token_body["access_token"]
print(f"tenant = {tenant_id}")

print("\n== Plan catalog")
status, plans = call(f"{CORE}/billing/plans", token=TOKEN)
check(status == 200, f"plans returned HTTP {status}: {plans}")
check(isinstance(plans, list) and plans, "no purchasable plans returned")
print(f"{len(plans)} plans available")
for plan in plans[:4]:
    print(
        f"  {plan['module_id']:<22} {plan['plan_id']:<14} "
        f"{plan['monthly_cents']} {plan['limits']}"
    )
check(
    all(p["stripe_price_id_monthly"] or p["stripe_price_id_annual"] for p in plans),
    "a plan without a Stripe price id was offered for sale",
)
print("PASS: every offered plan has a price id")

print("\n== Catalog requires authentication")
status, _ = call(f"{CORE}/billing/plans")
check(status in (401, 403), f"plans were readable without a token (HTTP {status})")
print(f"PASS: anonymous request rejected with HTTP {status}")

print("\n== Portal without a subscription")
status, detail = call(
    f"{CORE}/billing/portal", "POST", token=TOKEN, body={"return_url": "https://app/x"}
)
check(status == 409, f"expected HTTP 409, got {status}: {detail}")
print(f"PASS: HTTP {status} — {json.loads(detail)['detail']}")

print("\n== Checkout with an unknown price")
status, detail = call(
    f"{CORE}/billing/checkout",
    "POST",
    token=TOKEN,
    body={"price_id": "price_does_not_exist", "return_url": "https://app/x"},
)
check(status == 400, f"expected HTTP 400, got {status}: {detail}")
print(f"PASS: HTTP {status} — {json.loads(detail)['detail']}")

print("\n== Webhook rejects an unsigned payload")
status, _ = call(f"{CORE}/billing/webhook", "POST", body={"type": "customer.subscription.created"})
# 400 when Stripe is configured (bad signature); 503 when it is not. Either way
# the event is refused — what must never happen is a 200 that grants access.
check(status in (400, 503), f"unsigned webhook was not rejected (HTTP {status})")
print(f"PASS: HTTP {status} — forged webhooks cannot grant entitlements")

print("\nAll billing smoke checks passed.")
