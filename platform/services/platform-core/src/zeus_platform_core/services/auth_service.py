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
import logging
import os
import uuid

from zeus_adapters.interfaces import AuthProvider

from zeus_platform_core.domain.models import PLATFORM_ADMIN_ROLE, SubscriptionStatus
from zeus_platform_core.repositories.billing import SubscriptionRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.tenancy_service import TenancyService

# scrypt parameters: n=2^14, r=8, p=1 (~16 MiB) — interactive-login grade.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 16384, 8, 1

log = logging.getLogger(__name__)

#: Starter trial, one entry per service that is actually built.
#:
#: Each service is sold on its own, so each gets its own subscription row
#: rather than one blanket grant. That keeps the shape identical to a paying
#: customer's -- cancelling Grant Intelligence leaves Contract Compliance
#: untouched -- and it is why this is a list rather than a flag.
#:
#: ``audit_compliance`` is deliberately absent. It has plans and a catalogue
#: row but no service behind it, so trialling it would hand every new customer
#: a product that does not exist.
TRIAL_PLANS: tuple[tuple[str, str], ...] = (
    ("contract_compliance", "cc_starter"),
    ("grant_intelligence", "gi_starter"),
)


class AuthError(Exception):
    """Raised for signup/login failures; message is safe to show the user."""


class EmailNotVerifiedError(AuthError):
    """Correct password, but the address was never confirmed.

    Carries the user id so the caller can offer to resend the code. This is not
    an information leak: the password was already proven correct, so whoever
    sees it is the account holder.
    """

    def __init__(self, user_id: str, email: str) -> None:
        super().__init__("Verify your email address to sign in.")
        self.user_id = user_id
        self.email = email


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
        self,
        *,
        email: str,
        password: str,
        full_name: str,
        workspace_name: str | None = None,
    ) -> dict:
        """Create user + credentials + first tenant + trial; return a session."""
        email = email.strip().lower()
        full_name = full_name.strip()
        if "@" not in email or "." not in email.rsplit("@", 1)[-1] or len(email) < 6:
            raise AuthError("Enter a valid email address.")
        if len(full_name) < 2:
            raise AuthError("Enter your full name.")
        if len(full_name) > 120:
            raise AuthError("That name is too long.")
        if len(password) < 8:
            raise AuthError("Password must be at least 8 characters.")
        if await self._tenants.get_user_by_email(email) is not None:
            raise AuthError("An account with this email already exists.")

        user_id = str(uuid.uuid4())
        await self._tenants.upsert_user(user_id, email, provider="platform", full_name=full_name)
        await self._tenants.set_password_hash(user_id, hash_password(password))

        # Default the workspace to the person's name when they do not supply
        # one. "Ada Lovelace's Workspace" is a better empty state than a blank
        # field or a generic placeholder.
        tenant = await self._tenancy.provision_tenant(
            user_id=user_id,
            email=email,
            tenant_name=workspace_name or f"{full_name.split()[0]}'s Workspace",
        )

        # Start a trial of each service so the console isn't an empty shell.
        await self._start_trials(tenant.id)

        return await self._session_payload(user_id, email)

    async def login(self, *, email: str, password: str) -> dict:
        email = email.strip().lower()
        user = await self._tenants.get_user_by_email(email)
        stored = await self._tenants.get_password_hash(str(user["id"])) if user else None
        # Verify even when the user is missing (constant-ish time, no oracle).
        ok = verify_password(password, stored) if stored else False
        if not user or not ok:
            raise AuthError("Invalid email or password.")

        # Checked only after the password is confirmed. Reporting "unverified"
        # to someone who got the password wrong would tell an attacker which
        # addresses are registered.
        if user.get("email_verified_at") is None:
            raise EmailNotVerifiedError(str(user["id"]), email)

        return await self._session_payload(str(user["id"]), email)

    async def signin_with_google(
        self, *, subject: str, email: str, email_verified: bool, full_name: str | None
    ) -> dict:
        """Sign in (or register) a user via a verified Google identity.

        Google must have verified the address itself. An unverified Google
        account proves only that someone typed an address into Google, which is
        exactly the assurance we are trying to obtain.
        """
        if not email_verified:
            raise AuthError(
                "Your Google account's email is not verified. Verify it with Google first."
            )

        email = email.strip().lower()

        # 1. Known Google identity -> straight in. Matched on subject, so this
        #    keeps working even if the user changed their Gmail address.
        existing = await self._tenants.get_user_by_identity("google", subject)
        if existing is not None:
            await self._tenants.link_identity(
                user_id=str(existing["id"]), provider="google", subject=subject, email=email
            )
            return await self._session_payload(str(existing["id"]), str(existing["email"]))

        # 2. An account already uses this address, created with a password.
        by_email = await self._tenants.get_user_by_email(email)
        if by_email is not None:
            user_id = str(by_email["id"])
            if by_email.get("email_verified_at") is None:
                # The dangerous case, and the reason this branch exists.
                #
                # Anyone can sign up with someone else's address today, because
                # signup does not verify it. If we simply attached Google to
                # that account, the real owner would sign in with Google and
                # land inside an account the impostor still holds the password
                # to -- a silent, permanent account takeover.
                #
                # Google's proof of ownership beats an unproven password, so the
                # account is handed to the verified party and the password is
                # revoked. The impostor is locked out; the owner keeps the data.
                await self._tenants.clear_password_hash(user_id)
                log.warning(
                    "auth.google_claimed_unverified_account user_id=%s", user_id
                )
            await self._tenants.upsert_user(
                user_id, email, provider="platform", full_name=full_name
            )
            await self._tenants.mark_email_verified(user_id)
            await self._tenants.link_identity(
                user_id=user_id, provider="google", subject=subject, email=email
            )
            return await self._session_payload(user_id, email)

        # 3. Brand new user. Google has already verified the address, so this
        #    account starts verified and skips the email code entirely.
        user_id = str(uuid.uuid4())
        await self._tenants.upsert_user(
            user_id, email, provider="google", full_name=full_name
        )
        await self._tenants.mark_email_verified(user_id)
        await self._tenants.link_identity(
            user_id=user_id, provider="google", subject=subject, email=email
        )

        first_name = (full_name or email.split("@")[0]).split()[0]
        tenant = await self._tenancy.provision_tenant(
            user_id=user_id, email=email, tenant_name=f"{first_name}'s Workspace"
        )
        await self._start_trials(tenant.id)

        return await self._session_payload(user_id, email)

    async def _start_trials(self, tenant_id: str) -> None:
        """Open a starter trial on every service for a brand-new workspace.

        Entitlements are refreshed once at the end rather than per module: the
        refresh recomputes the whole tenant either way, so calling it inside
        the loop would repeat the same work for each service.
        """
        for module_id, plan_id in TRIAL_PLANS:
            await self._subscriptions.upsert(
                tenant_id=tenant_id,
                module_id=module_id,
                plan_id=plan_id,
                status=SubscriptionStatus.trialing,
                stripe_subscription_id=None,
            )
        await self._entitlements.refresh(tenant_id)

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
        #
        # The platform privilege rides on this token as well as on the
        # tenant-scoped one, because the admin surface is platform-wide and
        # should not require picking a workspace first -- an operator
        # investigating a tenant may not be a member of it. Sourced from the
        # database on every mint, so revoking the flag takes effect at the next
        # login or refresh rather than whenever the current token expires.
        roles = [PLATFORM_ADMIN_ROLE] if await self._tenants.is_platform_admin(user_id) else []
        token = await self._auth.issue_claims(user_id, "", roles)
        return {
            "access_token": token,
            "user_id": user_id,
            "email": email,
            "tenants": tenants,
        }
