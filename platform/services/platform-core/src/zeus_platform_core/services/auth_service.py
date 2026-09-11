"""First-party email/password authentication.

Passwords are hashed with stdlib ``hashlib.scrypt`` (no extra dependency;
memory-hard, OWASP-acceptable parameters). On signup we provision the user's
first tenant and start a Contract Compliance trial so the product is usable
the moment they land in the console.

This service *complements* the pluggable AuthProvider: it manages credentials
and identities, then delegates token minting to the provider, so the JWTs it
produces are indistinguishable from provider-issued ones.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import uuid

from zeus_adapters.interfaces import AuthProvider

from zeus_platform_core.domain.models import SubscriptionStatus
from zeus_platform_core.repositories.billing import SubscriptionRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.tenancy_service import TenancyService

# scrypt parameters: n=2^14, r=8, p=1 (~16 MiB) — interactive-login grade.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 16384, 8, 1

TRIAL_MODULE = "contract_compliance"
TRIAL_PLAN = "cc_starter"


class AuthError(Exception):
    """Raised for signup/login failures; message is safe to show the user."""


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, hash_hex = stored.split("$")
        if scheme != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt_hex),
            n=_SCRYPT_N,
            r=_SCRYPT_R,
            p=_SCRYPT_P,
        )
        return hmac.compare_digest(digest.hex(), hash_hex)
    except (ValueError, TypeError):
        return False


class AuthService:
    def __init__(
        self,
        *,
        tenants: TenantRepository,
        tenancy: TenancyService,
        subscriptions: SubscriptionRepository,
        entitlements: EntitlementsService,
        auth: AuthProvider,
    ) -> None:
        self._tenants = tenants
        self._tenancy = tenancy
        self._subscriptions = subscriptions
        self._entitlements = entitlements
        self._auth = auth

    async def signup(
        self, *, email: str, password: str, workspace_name: str | None = None
    ) -> dict:
        """Create user + credentials + first tenant + trial; return a session."""
        email = email.strip().lower()
        if "@" not in email or "." not in email.rsplit("@", 1)[-1] or len(email) < 6:
            raise AuthError("Enter a valid email address.")
        if len(password) < 8:
            raise AuthError("Password must be at least 8 characters.")
        if await self._tenants.get_user_by_email(email) is not None:
            raise AuthError("An account with this email already exists.")

        user_id = str(uuid.uuid4())
        await self._tenants.upsert_user(user_id, email, provider="platform")
        await self._tenants.set_password_hash(user_id, hash_password(password))

        tenant = await self._tenancy.provision_tenant(
            user_id=user_id, email=email, tenant_name=workspace_name
        )

        # Start a Contract Compliance trial so the console isn't an empty shell.
        await self._subscriptions.upsert(
            tenant_id=tenant.id,
            module_id=TRIAL_MODULE,
            plan_id=TRIAL_PLAN,
            status=SubscriptionStatus.trialing,
            stripe_subscription_id=None,
        )
        await self._entitlements.refresh(tenant.id)

        return await self._session_payload(user_id, email)

    async def login(self, *, email: str, password: str) -> dict:
        email = email.strip().lower()
        user = await self._tenants.get_user_by_email(email)
        stored = await self._tenants.get_password_hash(str(user["id"])) if user else None
        # Verify even when the user is missing (constant-ish time, no oracle).
        ok = verify_password(password, stored) if stored else False
        if not user or not ok:
            raise AuthError("Invalid email or password.")
        return await self._session_payload(str(user["id"]), email)

    async def session_for_user(self, user_id: str) -> dict:
        """Mint a session payload for an already-authenticated user.

        Used by the refresh endpoint, where the refresh cookie has already
        proven identity so there is no password to check. The email is re-read
        from the database rather than carried in the cookie so an address
        change takes effect on the next refresh.
        """
        user = await self._tenants.get_user_by_id(user_id)
        if user is None:
            raise AuthError("Account no longer exists.")
        return await self._session_payload(user_id, str(user["email"]))

    async def _session_payload(self, user_id: str, email: str) -> dict:
        tenants = await self._tenants.list_user_tenants(user_id)
        # User-level token: no tenant claim; the console exchanges it for a
        # tenant-scoped token via POST /tenancy/token.
        token = await self._auth.issue_claims(user_id, "", [])
        return {
            "access_token": token,
            "user_id": user_id,
            "email": email,
            "tenants": tenants,
        }
