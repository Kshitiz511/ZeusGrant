"""Authorization tests for the workspace-administration routes.

``test_membership.py`` covers the service rules. This file covers the layer
above them: who the HTTP routes let through at all. The two are separate on
purpose -- a service that refuses correctly is no help if the route never asks
it, and a route guard that is never exercised is the kind of thing that quietly
stops working.

The distinction being pinned down here is 403 versus 404. A caller who belongs
to the workspace but lacks the rank gets 403, because the workspace is not a
secret from them. A caller who does not belong gets 404, because 403 would
confirm the workspace exists and turn these routes into a customer list.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container

TENANT = "11111111-1111-1111-1111-111111111111"
CALLER = "user-1"
AUTH = {"Authorization": "Bearer good-token"}


class StubAuth:
    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id=CALLER, email="u@example.com", tenant_id=TENANT, roles=[])

    async def issue_claims(self, user_id, tenant_id, roles):  # pragma: no cover
        return "stub"


def _client(role: str | None) -> Iterator[TestClient]:
    """An app whose caller holds ``role`` in the active tenant.

    ``None`` means "not a member at all", which is the case the 404 branch
    exists for.
    """
    container = Container(db=FakeDatabase(), cache=MemoryCache(), auth=StubAuth())

    async def fake_role(*, tenant_id: str, user_id: str) -> str | None:
        return role

    async def fake_members(tenant_id: str) -> list[dict]:
        return [
            {
                "user_id": CALLER,
                "email": "u@example.com",
                "full_name": None,
                "role": role or "member",
                "created_at": None,
            }
        ]

    container.tenants.get_membership_role = fake_role  # type: ignore[method-assign]
    container.tenants.list_members = fake_members  # type: ignore[method-assign]

    with TestClient(create_app(container)) as client:
        yield client


@pytest.fixture
def owner() -> Iterator[TestClient]:
    yield from _client("owner")


@pytest.fixture
def admin() -> Iterator[TestClient]:
    yield from _client("admin")


@pytest.fixture
def member() -> Iterator[TestClient]:
    yield from _client("member")


@pytest.fixture
def outsider() -> Iterator[TestClient]:
    yield from _client(None)


def test_admin_can_list_the_workspace_members(admin: TestClient) -> None:
    response = admin.get("/tenancy/members", headers=AUTH)

    assert response.status_code == 200
    assert response.json()[0]["email"] == "u@example.com"


def test_member_cannot_list_the_workspace_members(member: TestClient) -> None:
    """A plain member is told plainly that they lack the rank."""
    response = member.get("/tenancy/members", headers=AUTH)

    assert response.status_code == 403


def test_non_member_gets_not_found_rather_than_forbidden(outsider: TestClient) -> None:
    """The workspace must not be confirmed to exist for someone outside it."""
    response = outsider.get("/tenancy/members", headers=AUTH)

    assert response.status_code == 404


def test_member_cannot_change_another_members_role(member: TestClient) -> None:
    response = member.patch("/tenancy/members/user-2", json={"role": "admin"}, headers=AUTH)

    assert response.status_code == 403


def test_member_cannot_invite(member: TestClient) -> None:
    response = member.post(
        "/tenancy/invites", json={"email": "new@example.com", "role": "member"}, headers=AUTH
    )

    assert response.status_code == 403


def test_admin_cannot_transfer_ownership(admin: TestClient) -> None:
    """Handing over the workspace is the owner's alone, not any admin's."""
    response = admin.post("/tenancy/members/transfer", json={"user_id": "user-2"}, headers=AUTH)

    assert response.status_code == 403


def test_owner_cannot_change_their_own_role(owner: TestClient) -> None:
    """Otherwise the last owner could demote themselves and strand the tenant."""
    response = owner.patch(f"/tenancy/members/{CALLER}", json={"role": "member"}, headers=AUTH)

    assert response.status_code == 400


def test_owner_cannot_remove_themselves(owner: TestClient) -> None:
    response = owner.delete(f"/tenancy/members/{CALLER}", headers=AUTH)

    assert response.status_code == 400


def test_role_endpoint_reports_the_callers_rank(member: TestClient) -> None:
    """The console reads this to decide which screens to offer."""
    response = member.get("/tenancy/me", headers=AUTH)

    assert response.status_code == 200
    assert response.json() == {"tenant_id": TENANT, "role": "member"}


def test_unauthenticated_callers_are_rejected(admin: TestClient) -> None:
    response = admin.get("/tenancy/members")

    assert response.status_code in (401, 403)
