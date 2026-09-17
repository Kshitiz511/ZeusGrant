"""Entitlements service — resolves and caches a tenant's access snapshot.

Flow: read subscriptions + plan-limit catalog -> compute claims (pure) ->
cache in Redis -> persist the derived snapshot. The guard reads the cached
claims, so access checks are a single fast lookup with a DB fallback.
"""

from __future__ import annotations

from collections.abc import Callable

from zeus_adapters.interfaces import Cache

from zeus_platform_core.domain.entitlements import compute_claims
from zeus_platform_core.domain.models import EntitlementClaims
from zeus_platform_core.repositories.billing import EntitlementRepository, SubscriptionRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.repositories.tenants import TenantRepository

_CACHE_PREFIX = "entitlements:"
#: Used only when no TTL provider is supplied, which in practice means a test.
#: The running system reads ``cache.entitlements_ttl_seconds``, which is
#: admin-editable and bounded.
_DEFAULT_TTL_SECONDS = 300


def _cache_key(tenant_id: str) -> str:
    return f"{_CACHE_PREFIX}{tenant_id}"


class EntitlementsService:
    def __init__(
        self,
        *,
        subscriptions: SubscriptionRepository,
        plans: PlanRepository,
        entitlements: EntitlementRepository,
        tenants: TenantRepository,
        cache: Cache,
        ttl_seconds: Callable[[], int] | None = None,
    ) -> None:
        self._subscriptions = subscriptions
        self._plans = plans
        self._entitlements = entitlements
        self._tenants = tenants
        self._cache = cache
        # A callable, not an int. This service is a cached_property on a
        # container that outlives any single request, so a value read at
        # construction time would pin the TTL to whatever it was when the
        # instance booted -- exactly the staleness defect D7 was about. Reading
        # it per write means an admin edit applies without waiting for a
        # recycle.
        self._ttl_seconds = ttl_seconds or (lambda: _DEFAULT_TTL_SECONDS)

    async def get_claims(self, tenant_id: str, *, use_cache: bool = True) -> EntitlementClaims:
        if use_cache:
            cached = await self._cache.get(_cache_key(tenant_id))
            if cached is not None:
                return EntitlementClaims.model_validate_json(cached)
        return await self.refresh(tenant_id)

    async def refresh(self, tenant_id: str) -> EntitlementClaims:
        """Recompute from source of truth, persist and cache. Call on billing changes.

        Four reads, not two: a tenant's access depends on its subscriptions, the
        plan catalogue, its own status (a suspended tenant gets nothing) and any
        per-tenant limit overrides. Leaving status out was the bug that let a
        suspended tenant keep working until its subscription happened to lapse.

        A tenant row that has vanished is treated as suspended rather than
        raising: refresh is called from webhook and background paths where an
        exception is far worse than a correct denial.
        """
        subs = await self._subscriptions.list_by_tenant(tenant_id)
        catalog = await self._plans.limit_catalog()
        tenant = await self._tenants.get_by_id(tenant_id)
        overrides = await self._tenants.limit_overrides_map(tenant_id)

        claims = compute_claims(
            tenant_id,
            subs,
            catalog,
            tenant_status=tenant.status if tenant else "deleted",
            overrides=overrides,
        )

        await self._entitlements.save(claims)
        await self._cache.set(
            _cache_key(tenant_id),
            claims.model_dump_json(),
            ttl_seconds=self._ttl_seconds(),
        )
        return claims

    async def invalidate(self, tenant_id: str) -> None:
        """Drop the cached snapshot so the next read recomputes.

        Callers that change access must call this, not merely rely on the TTL.
        Suspension in particular has to bite immediately; minutes of continued
        access to a tenant somebody just cut off is not acceptable. The TTL is
        the bound on an instance that missed this call, not the mechanism.
        """
        await self._cache.delete(_cache_key(tenant_id))
