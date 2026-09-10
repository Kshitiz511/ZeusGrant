"""Composition root — builds adapters, repositories and services from settings.

Dependencies are constructed lazily (cached properties) so importing the app
never requires full configuration; a piece is built the first time it is used
and fails loudly if its config is missing. Tests can inject fakes via the
constructor overrides.
"""

from __future__ import annotations

from functools import cached_property

from zeus_adapters import (
    build_auth_provider,
    build_billing_provider,
    build_cache,
    build_database,
)
from zeus_adapters.interfaces import AuthProvider, BillingProvider, Cache, Database
from zeus_config import SecretBox, Settings, get_settings

from zeus_platform_core.repositories.billing import EntitlementRepository, SubscriptionRepository
from zeus_platform_core.repositories.config_registry import ConfigRepository, PromptRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.billing_service import BillingService
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.auth_service import AuthService
from zeus_platform_core.services.tenancy_service import TenancyService


class Container:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        db: Database | None = None,
        cache: Cache | None = None,
        auth: AuthProvider | None = None,
        billing_provider: BillingProvider | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._db_override = db
        self._cache_override = cache
        self._auth_override = auth
        self._billing_provider_override = billing_provider

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
    def config(self) -> ConfigRepository:
        return ConfigRepository(self.db, self.secret_box)

    @cached_property
    def prompts(self) -> PromptRepository:
        return PromptRepository(self.db)

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
    def billing(self) -> BillingService:
        provider = self._billing_provider_override or build_billing_provider(self.settings)
        return BillingService(
            provider=provider,
            subscriptions=self.subscriptions,
            plans=self.plans,
            entitlements=self.entitlements,
        )

    # --- lifecycle ---
    async def startup(self) -> None:
        await self.db.connect()

    async def shutdown(self) -> None:
        await self.db.disconnect()
