"""Auth service tests: password hashing and the login/signup boundaries.

The signup happy path (tenant provisioning + trial) is covered by the live
E2E; here we pin the security-critical behavior with fakes.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_platform_core.repositories.billing import EntitlementRepository, SubscriptionRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.auth_service import (
    AuthError,
    AuthService,
    EmailNotVerifiedError,
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


def _db_with_user(*, verified: bool = True) -> FakeDatabase:
    db = FakeDatabase()
    # A verified account carries a timestamp; None means the address was never
    # confirmed, which is the state every password signup starts in.
    verified_at = datetime(2026, 1, 1, tzinfo=UTC) if verified else None
    db.on_fetch_one(
        "FROM platform.users WHERE lower(email)",
        lambda args: (
            {"id": USER_ID, "email": EMAIL, "email_verified_at": verified_at}
            if args[0] == EMAIL
            else None
        ),
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
async def test_unverified_account_cannot_sign_in():
    """A correct password is not enough until the address is proven.

    Without this, anyone could register under someone else's address and use
    the account normally, which makes the verification email decorative.
    """
    svc = _service(_db_with_user(verified=False))
    with pytest.raises(EmailNotVerifiedError) as caught:
        await svc.login(email=EMAIL, password=GOOD_PASSWORD)
    # The id rides along so the client can offer to resend the code.
    assert caught.value.user_id == USER_ID


@pytest.mark.asyncio
async def test_wrong_password_on_unverified_account_says_nothing_about_verification():
    """The verification state must not leak to someone who failed the password.

    A distinct 'unverified' reply for a bad password would confirm that an
    address is registered, turning the login form into an account-enumeration
    oracle.
    """
    svc = _service(_db_with_user(verified=False))
    with pytest.raises(AuthError) as caught:
        await svc.login(email=EMAIL, password="not-the-password")
    assert not isinstance(caught.value, EmailNotVerifiedError)
    assert "Invalid email or password" in str(caught.value)


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
        await svc.signup(email=EMAIL, password="whatever-123", full_name="Ada Lovelace")


@pytest.mark.asyncio
async def test_signup_rejects_weak_password_and_bad_email():
    svc = _service(FakeDatabase())
    with pytest.raises(AuthError, match="8 characters"):
        await svc.signup(email="new@example.com", password="short", full_name="Ada Lovelace")
    with pytest.raises(AuthError, match="valid email"):
        await svc.signup(
            email="not-an-email", password="long-enough-pass", full_name="Ada Lovelace"
        )


@pytest.mark.asyncio
async def test_signup_requires_a_real_name():
    svc = _service(FakeDatabase())
    with pytest.raises(AuthError, match="full name"):
        await svc.signup(email="new@example.com", password="long-enough-pass", full_name=" ")


# --- Google Sign-In ---------------------------------------------------------
#
# The linking rules are the sharpest edge in this file. Signup does not verify
# email addresses, so anyone can register under an address they do not own; the
# question is what happens when the rightful owner later arrives via Google.


def _google_db(*, existing_user: dict | None = None, identity: dict | None = None):
    db = FakeDatabase()
    db.on_fetch_one("FROM platform.user_identities", lambda args: identity)
    db.on_fetch_one(
        "FROM platform.users WHERE lower(email)",
        lambda args: existing_user,
    )
    db.on_fetch_one(
        "INSERT INTO platform.tenants",
        lambda args: {
            "id": "t-1",
            "name": args[0],
            "slug": args[1],
            "owner_user_id": args[2],
            "status": "active",
            "stripe_customer_id": None,
        },
    )
    db.on_fetch(
        "FROM platform.memberships",
        lambda args: [{"tenant_id": "t-1", "name": "Acme", "slug": "acme", "role": "owner"}],
    )
    return db


def _executed(db: FakeDatabase, needle: str) -> list:
    """Statements sent to the database, regardless of which method carried them.

    Deliberately not filtered to ``execute``: anything with a RETURNING clause
    goes through ``fetch_one``, so filtering by method would silently miss it
    and the assertion would pass for the wrong reason.
    """
    return [args for _kind, q, args in db.calls if needle in q]


@pytest.mark.asyncio
async def test_google_rejects_unverified_google_email():
    """An unverified Google address proves nothing.

    It means someone typed an address into Google, which is precisely the
    assurance we are trying to obtain. Accepting it would make the whole flow
    decorative.
    """
    svc = _service(_google_db())
    with pytest.raises(AuthError, match="not verified"):
        await svc.signin_with_google(
            subject="google-sub-1", email=EMAIL, email_verified=False, full_name="Ada"
        )


@pytest.mark.asyncio
async def test_google_matches_on_subject_not_email():
    """A known subject signs in even though the address has changed at Google.

    Matching on email would strand this user, or worse, hand their account to
    whoever later acquires the old address.
    """
    db = _google_db(identity={"id": USER_ID, "email": "old@example.com"})
    svc = _service(db)
    session = await svc.signin_with_google(
        subject="google-sub-1",
        email="new-address@example.com",
        email_verified=True,
        full_name="Ada",
    )
    assert session["user_id"] == USER_ID
    # No new tenant: this is a sign-in, not a registration.
    assert not _executed(db, "INSERT INTO platform.tenants")


@pytest.mark.asyncio
async def test_google_claiming_unverified_account_revokes_the_password():
    """The account-takeover case.

    An attacker signs up with the victim's address and a password we never
    verified. The victim then signs in with Google. If we merely attached the
    identity, the victim would land inside an account the attacker still holds
    the password to -- silent, permanent, and invisible to both parties.

    Google has proven ownership and the password holder has not, so the
    password is revoked.
    """
    db = _google_db(
        existing_user={"id": USER_ID, "email": EMAIL, "email_verified_at": None}
    )
    svc = _service(db)
    session = await svc.signin_with_google(
        subject="google-sub-9", email=EMAIL, email_verified=True, full_name="Ada"
    )
    assert session["user_id"] == USER_ID
    assert _executed(db, "DELETE FROM platform.user_credentials"), (
        "the unverified password must be revoked when Google claims the account"
    )


@pytest.mark.asyncio
async def test_google_linking_verified_account_keeps_the_password():
    """The benign case: the user proved the address, then added Google.

    Both credentials belong to the same person, so removing the password would
    be a gratuitous lockout.
    """
    db = _google_db(
        existing_user={
            "id": USER_ID,
            "email": EMAIL,
            "email_verified_at": "2026-01-01T00:00:00Z",
        }
    )
    svc = _service(db)
    await svc.signin_with_google(
        subject="google-sub-9", email=EMAIL, email_verified=True, full_name="Ada"
    )
    assert not _executed(db, "DELETE FROM platform.user_credentials")
    assert _executed(db, "INSERT INTO platform.user_identities")


@pytest.mark.asyncio
async def test_google_new_user_is_provisioned_and_pre_verified():
    db = _google_db()
    svc = _service(db)
    session = await svc.signin_with_google(
        subject="google-sub-new",
        email="brand-new@example.com",
        email_verified=True,
        full_name="Grace Hopper",
    )
    assert session["user_id"]
    assert _executed(db, "INSERT INTO platform.users")
    assert _executed(db, "INSERT INTO platform.tenants")
    # Google already proved the address, so no verification email is warranted.
    assert _executed(db, "SET email_verified_at = now()")
