"""End-to-end guard test: a tenant entitled to one module cannot reach another.

Uses the real FastAPI app with injected fakes: an in-memory cache, a fake
database whose queries return a single active Grant Intelligence subscription,
and a stub auth provider that trusts a fixed token.
"""

from __future__ import annotations

import pytest
from fastapi import APIRouter, Depends
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.security import require_module

TENANT = "11111111-1111-1111-1111-111111111111"


class StubAuth:
    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id="user-1", email="u@example.com", tenant_id=TENANT, roles=[])

    async def issue_claims(self, user_id, tenant_id, roles):  # pragma: no cover
        return "stub"


def _fake_db() -> FakeDatabase:
    db = FakeDatabase()
    # The tenant itself must exist and be active. Entitlement resolution reads
    # the status, and a tenant it cannot find is treated as deleted -- so
    # omitting this row does not produce a neutral fixture, it produces a
    # suspended one.
    db.on_fetch_one(
        "FROM platform.tenants",
        lambda args: {
            "id": TENANT,
            "name": "Probe Co",
            "slug": "probe-co",
            "owner_user_id": "user-1",
            "status": "active",
            "stripe_customer_id": None,
        },
    )
    # No per-tenant limit overrides: this tenant gets exactly what its plan says.
    db.on_fetch("FROM platform.tenant_limit_overrides", lambda args: [])
    # Tenant t has one ACTIVE grant_intelligence subscription.
    db.on_fetch(
        "FROM platform.subscriptions",
        lambda args: [
            {
                "tenant_id": TENANT,
                "module_id": "grant_intelligence",
                "plan_id": "gi_growth",
                "status": "active",
                "stripe_subscription_id": "sub_1",
                "environment": "live",
                "current_period_end": None,
            }
        ],
    )
    db.on_fetch(
        "FROM platform.plan_limits",
        lambda args: [
            {"plan_id": "gi_growth", "limit_key": "matches_per_month", "limit_value": 100}
        ],
    )
    # entitlement save (execute) -> OK by default
    return db


@pytest.fixture
def client() -> TestClient:
    container = Container(db=_fake_db(), cache=MemoryCache(), auth=StubAuth())

    app = create_app(container)

    # Mount two guarded probe routes representing two different modules.
    probe = APIRouter(prefix="/probe")

    @probe.get("/grant", dependencies=[Depends(require_module("grant_intelligence"))])
    async def grant_ok():
        return {"ok": True}

    @probe.get("/contract", dependencies=[Depends(require_module("contract_compliance"))])
    async def contract_ok():
        return {"ok": True}

    app.include_router(probe)
    return TestClient(app)


def _auth():
    return {"Authorization": "Bearer good-token"}


def test_no_token_is_401(client):
    assert client.get("/probe/grant").status_code == 401


def test_bad_token_is_401(client):
    assert client.get("/probe/grant", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_entitled_module_allowed(client):
    resp = client.get("/probe/grant", headers=_auth())
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_unentitled_module_forbidden(client):
    resp = client.get("/probe/contract", headers=_auth())
    assert resp.status_code == 403


def test_entitlements_me_reports_only_purchased(client):
    resp = client.get("/entitlements/me", headers=_auth())
    assert resp.status_code == 200
    body = resp.json()
    assert "grant_intelligence" in body["modules"]
    assert "contract_compliance" not in body["modules"]


# --- cross-tenant access --------------------------------------------------
#
# X-Tenant-Id lets somebody in several workspaces switch between them, which
# makes the active tenant caller-supplied input. It was trusted without
# checking, so any signed-in user could read any tenant by naming it. Neither
# other layer catches this: the entitlement guard asks whether *that* tenant
# bought the module, and RLS isolates faithfully to whichever tenant it is
# handed. Membership is the only thing that can tell the difference.

OTHER_TENANT = "22222222-2222-2222-2222-222222222222"


def test_header_naming_a_foreign_tenant_is_refused(client):
    resp = client.get(
        "/probe/grant", headers={**_auth(), "X-Tenant-Id": OTHER_TENANT}
    )
    # 404 rather than 403, so the response cannot be used to discover which
    # tenant ids exist.
    assert resp.status_code == 404


def test_foreign_tenant_cannot_be_read_through_entitlements(client):
    resp = client.get(
        "/entitlements/me", headers={**_auth(), "X-Tenant-Id": OTHER_TENANT}
    )
    assert resp.status_code == 404


def test_header_naming_the_session_tenant_still_works(client):
    """The switching feature must keep working; only the forgery is blocked."""
    resp = client.get("/probe/grant", headers={**_auth(), "X-Tenant-Id": TENANT})
    assert resp.status_code == 200
