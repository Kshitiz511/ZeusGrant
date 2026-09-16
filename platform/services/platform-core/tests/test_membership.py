"""Workspace membership: roles, seats and invites.

These exercise the service against a fake database rather than the routers,
because the interesting behaviour is the rules -- who may be demoted, what
consumes a seat, which invite is redeemable by whom -- and those are decided
in the service. The HTTP layer is a thin mapping onto status codes and is
covered where it makes a decision of its own (self-demotion).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_platform_core.domain.models import (
    EntitlementClaims,
    ModuleEntitlement,
    Role,
)
from zeus_platform_core.services.tenancy_service import (
    SeatLimitReached,
    TenancyError,
    TenancyService,
    hash_invite_token,
)

TENANT = "11111111-1111-1111-1111-111111111111"
OWNER = "00000000-0000-0000-0000-00000000000a"
MEMBER = "00000000-0000-0000-0000-00000000000b"


class FakeTenants:
    """Just enough of TenantRepository to drive the service's decisions."""

    def __init__(self, *, members: int = 1, invites: list[dict] | None = None) -> None:
        self._members = members
        self.invites = invites or []
        self.memberships: list[dict] = []
        self.roles: dict[str, str] = {OWNER: "owner"}
        self.removed: list[str] = []
        self.accepted: list[str] = []
        self.transfers: list[tuple[str, str]] = []
        self.user_by_email: dict[str, dict] = {}
        self.create_fails = False
        self.accept_succeeds = True
        self.update_succeeds = True
        self.remove_succeeds = True

    async def count_members(self, tenant_id):
        return self._members

    async def list_invites(self, tenant_id):
        return self.invites

    async def get_user_by_email(self, email):
        return self.user_by_email.get(email.lower())

    async def get_membership_role(self, *, tenant_id, user_id):
        return self.roles.get(user_id)

    async def create_invite(self, **kw):
        if self.create_fails:
            raise RuntimeError("duplicate")
        self.last_invite = kw
        return {
            "id": "inv-1",
            "tenant_id": kw["tenant_id"],
            "email": kw["email"],
            "role": kw["role"],
            "expires_at": datetime.now(UTC) + timedelta(hours=kw["ttl_hours"]),
            "created_at": datetime.now(UTC),
        }

    async def get_invite_by_hash(self, token_hash):
        for inv in self.invites:
            if inv.get("token_hash") == token_hash:
                return inv
        return None

    async def mark_invite_accepted(self, *, invite_id, user_id):
        if not self.accept_succeeds:
            return False
        self.accepted.append(invite_id)
        return True

    async def add_membership(self, *, tenant_id, user_id, role, invited_by=None):
        self.memberships.append({"user_id": user_id, "role": str(role)})

    async def update_member_role(self, *, tenant_id, user_id, role):
        return self.update_succeeds

    async def remove_member(self, *, tenant_id, user_id):
        if not self.remove_succeeds:
            return False
        self.removed.append(user_id)
        return True

    async def transfer_ownership(self, *, tenant_id, from_user_id, to_user_id):
        self.transfers.append((from_user_id, to_user_id))

    async def revoke_invite(self, *, tenant_id, invite_id):
        return True


class FakeEntitlements:
    def __init__(self, seats: int | None) -> None:
        self._seats = seats

    async def get_claims(self, tenant_id):
        return EntitlementClaims(
            tenant_id=tenant_id,
            modules={
                "contract_compliance": ModuleEntitlement(
                    module_id="contract_compliance",
                    plan_id="cc_growth",
                    status="active",
                    limits={"team_seats": self._seats},
                )
            },
        )


def _service(tenants: FakeTenants, *, seats: int | None = 3, cache=None, email=None):
    return TenancyService(
        tenants,
        cache=cache,
        email=email,
        entitlements=FakeEntitlements(seats),
        app_base_url="https://app.example.com",
    )


# --- seats ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pending_invites_consume_seats():
    """Otherwise an admin can issue more invites than the plan allows and the
    overflow only surfaces when somebody tries to accept."""
    tenants = FakeTenants(members=1, invites=[{"id": "a"}, {"id": "b"}])
    usage = await _service(tenants, seats=3).seat_usage(TENANT)
    assert usage == {"used": 1, "pending": 2, "limit": 3, "remaining": 0}


@pytest.mark.asyncio
async def test_missing_seat_limit_means_unlimited():
    """A missing plan_limits row is unlimited throughout this schema. The
    opposite default would have locked every existing workspace out of
    inviting anybody the moment this shipped."""
    tenants = FakeTenants(members=9)
    usage = await _service(tenants, seats=None).seat_usage(TENANT)
    assert usage["limit"] is None
    assert usage["remaining"] is None


@pytest.mark.asyncio
async def test_invite_is_refused_when_seats_are_full():
    tenants = FakeTenants(members=3)
    with pytest.raises(SeatLimitReached):
        await _service(tenants, seats=3).invite_member(
            tenant_id=TENANT,
            tenant_name="Acme",
            email="new@example.com",
            role=Role.member,
            invited_by=OWNER,
        )


# --- roles ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_owner_role_cannot_be_assigned_directly():
    """A second owner would violate the one-owner index. Refusing here gives a
    usable message instead of a unique violation surfacing as a 500."""
    with pytest.raises(TenancyError):
        await _service(FakeTenants()).change_role(
            tenant_id=TENANT, user_id=MEMBER, role=Role.owner
        )


@pytest.mark.asyncio
async def test_removing_the_owner_is_refused():
    tenants = FakeTenants()
    tenants.remove_succeeds = False  # the SQL excludes role = 'owner'
    with pytest.raises(TenancyError):
        await _service(tenants).remove_member(tenant_id=TENANT, user_id=OWNER)


@pytest.mark.asyncio
async def test_ownership_cannot_go_to_a_non_member():
    tenants = FakeTenants()
    with pytest.raises(TenancyError):
        await _service(tenants).transfer_ownership(
            tenant_id=TENANT, from_user_id=OWNER, to_user_id="stranger"
        )
    assert tenants.transfers == []


@pytest.mark.asyncio
async def test_removal_evicts_the_membership_cache():
    """service-kit caches membership for 60s, including positives. Without the
    eviction a removed member keeps access for up to a minute -- exactly the
    situation the admin pressing remove is trying to end."""
    cache = MemoryCache()
    key = f"membership:{MEMBER}:{TENANT}"
    await cache.set(key, "1", ttl_seconds=60)
    await _service(FakeTenants(), cache=cache).remove_member(
        tenant_id=TENANT, user_id=MEMBER
    )
    assert await cache.get(key) is None


# --- invites ----------------------------------------------------------------


def _invite(**over) -> dict:
    base = {
        "id": "inv-1",
        "tenant_id": TENANT,
        "tenant_name": "Acme",
        "email": "invited@example.com",
        "role": "member",
        "token_hash": hash_invite_token("tok"),
        "expires_at": datetime.now(UTC) + timedelta(days=1),
        "accepted_at": None,
        "revoked_at": None,
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_invite_token_is_stored_hashed():
    """The plaintext must never reach the database: a read of the invites table
    would otherwise hand out working credentials to every workspace."""
    tenants = FakeTenants()
    result = await _service(tenants).invite_member(
        tenant_id=TENANT,
        tenant_name="Acme",
        email="New@Example.com",
        role=Role.member,
        invited_by=OWNER,
    )
    stored = tenants.last_invite["token_hash"]
    token = result["accept_url"].split("token=")[1]
    assert stored != token
    assert stored == hash_invite_token(token)
    # Addresses are normalised, so Example.com and example.com are one person.
    assert tenants.last_invite["email"] == "new@example.com"


@pytest.mark.asyncio
async def test_invite_cannot_be_redeemed_by_a_different_address():
    """The link is not a transferable credential. Without this check anyone who
    saw a forwarded invite could join a workspace under their own account."""
    tenants = FakeTenants(invites=[_invite()])
    with pytest.raises(TenancyError, match="different email"):
        await _service(tenants).accept_invite(
            token="tok", user_id=MEMBER, user_email="someone.else@example.com"
        )
    assert tenants.memberships == []


@pytest.mark.asyncio
async def test_expired_invite_is_refused():
    tenants = FakeTenants(
        invites=[_invite(expires_at=datetime.now(UTC) - timedelta(minutes=1))]
    )
    with pytest.raises(TenancyError, match="expired"):
        await _service(tenants).accept_invite(
            token="tok", user_id=MEMBER, user_email="invited@example.com"
        )


@pytest.mark.asyncio
async def test_revoked_invite_is_refused():
    tenants = FakeTenants(invites=[_invite(revoked_at=datetime.now(UTC))])
    with pytest.raises(TenancyError, match="revoked"):
        await _service(tenants).accept_invite(
            token="tok", user_id=MEMBER, user_email="invited@example.com"
        )


@pytest.mark.asyncio
async def test_losing_a_race_to_accept_does_not_create_a_membership():
    """Two people clicking the same link both pass the reads above. Only one
    updates a row; the other must not be joined anyway."""
    tenants = FakeTenants(invites=[_invite()])
    tenants.accept_succeeds = False
    with pytest.raises(TenancyError):
        await _service(tenants).accept_invite(
            token="tok", user_id=MEMBER, user_email="invited@example.com"
        )
    assert tenants.memberships == []


@pytest.mark.asyncio
async def test_accepting_grants_the_invited_role_not_a_chosen_one():
    tenants = FakeTenants(invites=[_invite(role="viewer")])
    result = await _service(tenants).accept_invite(
        token="tok", user_id=MEMBER, user_email="invited@example.com"
    )
    assert result["role"] == "viewer"
    assert tenants.memberships == [{"user_id": MEMBER, "role": "viewer"}]


@pytest.mark.asyncio
async def test_existing_member_is_not_invited_twice():
    tenants = FakeTenants()
    tenants.user_by_email["member@example.com"] = {"id": MEMBER}
    tenants.roles[MEMBER] = "member"
    with pytest.raises(TenancyError, match="already in this workspace"):
        await _service(tenants).invite_member(
            tenant_id=TENANT,
            tenant_name="Acme",
            email="member@example.com",
            role=Role.member,
            invited_by=OWNER,
        )


@pytest.mark.asyncio
async def test_a_failed_send_still_returns_a_usable_link():
    """Email is the least reliable part of this flow and the one the product
    cannot fix. The invite is already committed, so the admin gets the link."""

    class BrokenEmail:
        async def send(self, **kw):
            raise RuntimeError("provider down")

    result = await _service(FakeTenants(), email=BrokenEmail()).invite_member(
        tenant_id=TENANT,
        tenant_name="Acme",
        email="new@example.com",
        role=Role.member,
        invited_by=OWNER,
    )
    assert result["email_sent"] is False
    assert result["accept_url"].startswith("https://app.example.com/invite?token=")
