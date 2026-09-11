"""Composition root — builds adapters, repositories and services from settings.

Dependencies are constructed lazily (cached properties) so importing the app
never requires full configuration; a piece is built the first time it is used
and fails loudly if its config is missing. Tests can inject fakes via the
constructor overrides.
"""

from __future__ import annotations

import logging
import os
import time
from functools import cached_property
from typing import TYPE_CHECKING, get_args

from pydantic import SecretStr
from zeus_adapters import (
    build_auth_provider,
    build_billing_provider,
    build_cache,
    build_database,
)
from zeus_adapters.interfaces import (
    AuthProvider,
    BillingProvider,
    Cache,
    Database,
    EmailSender,
)
from zeus_config import SecretBox, Settings, get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    # Imported lazily at runtime so a deployment without Google configured does
    # not pay for the import, and a missing optional dependency cannot break
    # startup for everyone else.
    from zeus_platform_core.services.email_verification_service import (
        EmailVerificationService,
    )
    from zeus_platform_core.services.google_oauth import GoogleOAuthService

from zeus_platform_core.repositories.billing import (
    BillingEventRepository,
    EntitlementRepository,
    SubscriptionRepository,
)
from zeus_platform_core.repositories.config_registry import ConfigRepository, PromptRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.repositories.sessions import SessionRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.auth_service import AuthService
from zeus_platform_core.services.billing_service import BillingService
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.runtime_config import (
    MANAGED_KEYS,
    RuntimeConfigService,
)
from zeus_platform_core.services.session_service import SessionService
from zeus_platform_core.services.tenancy_service import TenancyService

logger = logging.getLogger(__name__)

#: How long a resolved settings snapshot is trusted before re-reading overrides.
SETTINGS_REFRESH_SECONDS = 60.0


def _overlay(settings: Settings, overrides: dict[str, str]) -> Settings:
    """Return a copy of ``settings`` with dotted-path ``overrides`` applied.

    Values arrive as strings from the config store, so each is coerced to the
    type the target field already holds. Anything that will not coerce is
    skipped with a warning rather than raised: a malformed value typed into the
    dashboard must not brick every request until someone fixes the database.
    """
    if not overrides:
        return settings
    updated = settings.model_copy(deep=True)
    for path, raw in overrides.items():
        group_name, _, field = path.partition(".")
        group = getattr(updated, group_name, None)
        if group is None or field not in type(group).model_fields:
            logger.warning("config.unknown_settings_path path=%s", path)
            continue
        # Coerce against the declared annotation, not the current value: an
        # optional secret that is still None would otherwise be stored as a
        # bare str and leak in reprs.
        annotation = type(group).model_fields[field].annotation
        members = set(get_args(annotation)) or {annotation}
        try:
            if SecretStr in members:
                value: object = SecretStr(raw)
            elif bool in members:
                value = raw.strip().lower() in {"1", "true", "yes", "on"}
            elif int in members:
                value = int(raw)
            elif float in members:
                value = float(raw)
            else:
                value = raw
            object.__setattr__(group, field, value)
        except (TypeError, ValueError):
            logger.warning("config.bad_override path=%s", path)
    return updated


class Container:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: Database | None = None,
        cache: Cache | None = None,
        auth: AuthProvider | None = None,
        billing_provider: BillingProvider | None = None,
        email: EmailSender | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._db_override = db
        self._cache_override = cache
        self._auth_override = auth
        self._billing_provider_override = billing_provider
        self._email_override = email
        # Settings with admin-dashboard overrides applied. Starts as the plain
        # environment view so the app is usable before the database is reachable.
        self._effective: Settings = self.settings
        self._effective_at: float = 0.0

    # --- adapters (lazy) ---
    @cached_property
    def db(self) -> Database:
        return self._db_override or build_database(self.settings)

    @cached_property
    def cache(self) -> Cache:
        return self._cache_override or build_cache(self.settings)

    @cached_property
    def auth(self) -> AuthProvider:
        return self._auth_override or build_auth_provider(self.settings)

    @cached_property
    def secret_box(self) -> SecretBox | None:
        key = self.settings.secrets_encryption_key
        return SecretBox(key.get_secret_value()) if key is not None else None

    # --- repositories (lazy) ---
    @cached_property
    def tenants(self) -> TenantRepository:
        return TenantRepository(self.db)

    @cached_property
    def subscriptions(self) -> SubscriptionRepository:
        return SubscriptionRepository(self.db)

    @cached_property
    def plans(self) -> PlanRepository:
        return PlanRepository(self.db)

    @cached_property
    def entitlement_repo(self) -> EntitlementRepository:
        return EntitlementRepository(self.db)

    @cached_property
    def billing_events(self) -> BillingEventRepository:
        return BillingEventRepository(self.db)

    @cached_property
    def session_repo(self) -> SessionRepository:
        return SessionRepository(self.db)

    @cached_property
    def config(self) -> ConfigRepository:
        return ConfigRepository(self.db, self.secret_box)

    @cached_property
    def prompts(self) -> PromptRepository:
        return PromptRepository(self.db)

    @cached_property
    def runtime_config(self) -> RuntimeConfigService:
        return RuntimeConfigService(
            config=self.config, cache=self.cache, env=dict(os.environ)
        )

    # --- admin-managed settings overlay ---
    async def effective_settings(self) -> Settings:
        """Settings with dashboard overrides applied.

        Re-resolved at most once per :data:`SETTINGS_REFRESH_SECONDS` so an
        admin edit propagates without a redeploy, while a warm serverless
        instance does not pay a database round trip on every request. A failure
        here returns the last good snapshot rather than taking the app down —
        losing an override is recoverable, refusing to serve is not.
        """
        now = time.monotonic()
        if now - self._effective_at < SETTINGS_REFRESH_SECONDS:
            return self._effective
        try:
            overrides: dict[str, str] = {}
            for spec in MANAGED_KEYS:
                if spec.settings_path is None:
                    continue
                value = await self.runtime_config.get(spec.key)
                if value is not None:
                    overrides[spec.settings_path] = value
            self._effective = _overlay(self.settings, overrides)
        except Exception:  # pragma: no cover - defensive
            logger.exception("config.overlay_failed; serving previous settings")
        self._effective_at = now
        return self._effective

    def invalidate_settings(self) -> None:
        """Force the next :meth:`effective_settings` call to re-resolve."""
        self._effective_at = 0.0

    # --- services (lazy) ---
    @cached_property
    def entitlements(self) -> EntitlementsService:
        return EntitlementsService(
            subscriptions=self.subscriptions,
            plans=self.plans,
            entitlements=self.entitlement_repo,
            cache=self.cache,
        )

    @cached_property
    def tenancy(self) -> TenancyService:
        return TenancyService(self.tenants)

    @cached_property
    def auth_service(self) -> AuthService:
        return AuthService(
            tenants=self.tenants,
            tenancy=self.tenancy,
            subscriptions=self.subscriptions,
            entitlements=self.entitlements,
            auth=self.auth,
        )

    @cached_property
    def google_oauth(self) -> GoogleOAuthService:
        """Google Sign-In client.

        Constructed lazily and only when configured; the router checks
        ``google_configured`` before touching this, so the assertion here is a
        guard against a future caller forgetting to.
        """
        from zeus_platform_core.services.google_oauth import GoogleOAuthService

        cfg = self.settings.auth
        if not cfg.google_configured:
            raise RuntimeError("Google sign-in is not configured.")
        return GoogleOAuthService(
            client_id=cfg.google_client_id or "",
            client_secret=(
                cfg.google_client_secret.get_secret_value() if cfg.google_client_secret else ""
            ),
            redirect_uri=cfg.google_redirect_uri or "",
            cache=self.cache,
        )

    @cached_property
    def email_sender(self) -> EmailSender:
        from zeus_adapters.email import build_email_sender

        return self._email_override or build_email_sender(self.settings)

    @cached_property
    def email_verification(self) -> EmailVerificationService:
        from zeus_platform_core.services.email_verification_service import (
            EmailVerificationService,
        )

        return EmailVerificationService(
            tenants=self.tenants,
            email=self.email_sender,
            ttl_minutes=self.settings.email.verification_ttl_minutes,
        )

    @cached_property
    def sessions(self) -> SessionService:
        return SessionService(
            sessions=self.session_repo,
            ttl_seconds=self.settings.session.ttl_seconds,
            reuse_leeway_seconds=self.settings.session.reuse_leeway_seconds,
        )

    @cached_property
    def billing(self) -> BillingService:
        override = self._billing_provider_override
        # Deferred: building the Stripe client requires credentials that a dev
        # or self-host environment may not have, and the plan catalog must
        # still work without them. Reads the overlay snapshot so a key entered
        # in the admin dashboard is picked up without a redeploy.
        factory = (
            (lambda: override)
            if override is not None
            else (lambda: build_billing_provider(self._effective))
        )
        return BillingService(
            provider=factory,
            subscriptions=self.subscriptions,
            plans=self.plans,
            entitlements=self.entitlements,
            events=self.billing_events,
        )

    # --- lifecycle ---
    async def startup(self) -> None:
        await self.db.connect()
        # Resolve overrides once the database is up so the first request already
        # sees dashboard-managed values.
        await self.effective_settings()

    async def shutdown(self) -> None:
        await self.db.disconnect()
