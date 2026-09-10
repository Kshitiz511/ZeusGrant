"""Auth service tests: password hashing and the login/signup boundaries.

The signup happy path (tenant provisioning + trial) is covered by the live
E2E; here we pin the security-critical behavior with fakes.
"""

from __future__ import annotations

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_platform_core.repositories.billing import EntitlementRepository, SubscriptionRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.auth_service import (
    AuthError,
    AuthService,
    hash_password,
    verify_password,
)
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.tenancy_service import TenancyService

USER_ID = "22222222-2222-2222-2222-222222222222"
EMAIL = "user@example.com"
GOOD_PASSWORD = "correct-horse-battery"


class StubAuth:
    async def verify(self, token: str):  # pragma: no cover
        raise NotImplementedError

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        return f"token-for:{user_id}"


def _service(db: FakeDatabase) -> AuthService:
    tenants = TenantRepository(db)
    cache = MemoryCache()
    entitlements = EntitlementsService(
        subscriptions=SubscriptionRepository(db),
        plans=PlanRepository(db),
        entitlements=EntitlementRepository(db),
        cache=cache,
    )
    return AuthService(
        tenants=tenants,
        tenancy=TenancyService(tenants),
        subscriptions=SubscriptionRepository(db),
        entitlements=entitlements,
        auth=StubAuth(),
    )


def test_password_hash_roundtrip():
    stored = hash_password(GOOD_PASSWORD)
    assert stored.startswith("scrypt$")
    assert verify_password(GOOD_PASSWORD, stored)
    assert not verify_password("wrong-password", stored)
    assert not verify_password(GOOD_PASSWORD, "garbage")
    # Same password hashes differently (unique salt).
    assert hash_password(GOOD_PASSWORD) != stored


def _db_with_user() -> FakeDatabase:
    db = FakeDatabase()
    db.on_fetch_one(
        "FROM platform.users WHERE lower(email)",
        lambda args: {"id": USER_ID, "email": EMAIL} if args[0] == EMAIL else None,
    )
    db.on_fetch_one(
        "FROM platform.user_credentials",
        lambda args: {"password_hash": hash_password(GOOD_PASSWORD)},
    )
    db.on_fetch(
        "FROM platform.memberships",
        lambda args: [
            {"tenant_id": "t-1", "name": "Acme", "slug": "acme", "role": "owner"}
        ],
    )
    return db


@pytest.mark.asyncio
async def test_login_success():
    svc = _service(_db_with_user())
    session = await svc.login(email=EMAIL, password=GOOD_PASSWORD)
    assert session["access_token"] == f"token-for:{USER_ID}"
    assert session["user_id"] == USER_ID
    assert session["tenants"][0]["role"] == "owner"


@pytest.mark.asyncio
async def test_login_wrong_password():
    svc = _service(_db_with_user())
    with pytest.raises(AuthError):
        await svc.login(email=EMAIL, password="wrong-password")


@pytest.mark.asyncio
async def test_login_unknown_email():
    svc = _service(FakeDatabase())
    with pytest.raises(AuthError):
        await svc.login(email="nobody@example.com", password=GOOD_PASSWORD)


@pytest.mark.asyncio
async def test_signup_rejects_duplicate_email():
    svc = _service(_db_with_user())
    with pytest.raises(AuthError, match="already exists"):
        await svc.signup(email=EMAIL, password="whatever-123")


@pytest.mark.asyncio
async def test_signup_rejects_weak_password_and_bad_email():
    svc = _service(FakeDatabase())
    with pytest.raises(AuthError, match="8 characters"):
        await svc.signup(email="new@example.com", password="short")
    with pytest.raises(AuthError, match="valid email"):
        await svc.signup(email="not-an-email", password="long-enough-pass")
