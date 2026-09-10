"""Tests for POST /tenancy/token — the session → tenant-scoped-token exchange.

Membership is the security boundary: a caller can only mint a token for a
tenant they belong to, and the minted token must carry that tenant + role.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container

TENANT = "11111111-1111-1111-1111-111111111111"
OTHER_TENANT = "99999999-9999-9999-9999-999999999999"
USER = "22222222-2222-2222-2222-222222222222"


class StubAuth:
    """Trusts one token; records what claims were issued."""

    def __init__(self) -> None:
        self.issued: list[tuple[str, str, list[str]]] = []

    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id=USER, email="u@example.com", tenant_id=None, roles=["member"])

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        self.issued.append((user_id, tenant_id, list(roles)))
        return f"tenant-token:{tenant_id}"


def _fake_db() -> FakeDatabase:
    db = FakeDatabase()

    def membership(args):
        tenant_id, user_id = args
        if tenant_id == TENANT and user_id == USER:
            return {"role": "owner"}
        return None

    db.on_fetch_one("FROM platform.memberships", membership)
    return db


@pytest.fixture
def stub_auth() -> StubAuth:
    return StubAuth()


@pytest.fixture
def client(stub_auth: StubAuth) -> TestClient:
    container = Container(db=_fake_db(), cache=MemoryCache(), auth=stub_auth)
    return TestClient(create_app(container))


def _auth():
    return {"Authorization": "Bearer good-token"}


def test_exchange_requires_auth(client):
    resp = client.post("/tenancy/token", json={"tenant_id": TENANT})
    assert resp.status_code == 401


def test_member_gets_tenant_scoped_token(client, stub_auth):
    resp = client.post("/tenancy/token", json={"tenant_id": TENANT}, headers=_auth())
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"] == f"tenant-token:{TENANT}"
    assert body["tenant_id"] == TENANT
    assert body["role"] == "owner"
    # Claims issued for the right subject, tenant, and merged roles.
    assert stub_auth.issued == [(USER, TENANT, sorted({"owner", "member"}))]


def test_non_member_is_forbidden(client, stub_auth):
    resp = client.post("/tenancy/token", json={"tenant_id": OTHER_TENANT}, headers=_auth())
    assert resp.status_code == 403
    assert stub_auth.issued == []  # nothing minted on rejection
