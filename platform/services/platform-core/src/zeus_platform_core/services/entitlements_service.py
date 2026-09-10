"""Entitlements service — resolves and caches a tenant's access snapshot.

Flow: read subscriptions + plan-limit catalog -> compute claims (pure) ->
cache in Redis -> persist the derived snapshot. The guard reads the cached
claims, so access checks are a single fast lookup with a DB fallback.
"""

from __future__ import annotations

from zeus_adapters.interfaces import Cache

from zeus_platform_core.domain.entitlements import compute_claims
from zeus_platform_core.domain.models import EntitlementClaims
from zeus_platform_core.repositories.billing import EntitlementRepository, SubscriptionRepository
from zeus_platform_core.repositories.plans import PlanRepository

_CACHE_PREFIX = "entitlements:"
_CACHE_TTL_SECONDS = 300


def _cache_key(tenant_id: str) -> str:
    return f"{_CACHE_PREFIX}{tenant_id}"


class EntitlementsService:
    def __init__(
        self,
        *,
        subscriptions: SubscriptionRepository,
        plans: PlanRepository,
        entitlements: EntitlementRepository,
        cache: Cache,
    ) -> None:
        self._subscriptions = subscriptions
        self._plans = plans
        self._entitlements = entitlements
        self._cache = cache

    async def get_claims(self, tenant_id: str, *, use_cache: bool = True) -> EntitlementClaims:
        if use_cache:
            cached = await self._cache.get(_cache_key(tenant_id))
            if cached is not None:
                return EntitlementClaims.model_validate_json(cached)
        return await self.refresh(tenant_id)

    async def refresh(self, tenant_id: str) -> EntitlementClaims:
        """Recompute from source of truth, persist and cache. Call on billing changes."""
        subs = await self._subscriptions.list_by_tenant(tenant_id)
        catalog = await self._plans.limit_catalog()
        claims = compute_claims(tenant_id, subs, catalog)

        await self._entitlements.save(claims)
        await self._cache.set(
            _cache_key(tenant_id), claims.model_dump_json(), ttl_seconds=_CACHE_TTL_SECONDS
        )
        return claims

    async def invalidate(self, tenant_id: str) -> None:
        await self._cache.delete(_cache_key(tenant_id))
