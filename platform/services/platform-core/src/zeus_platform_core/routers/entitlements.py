"""Entitlement endpoints: what the current tenant can access."""

from __future__ import annotations

from fastapi import APIRouter

from zeus_platform_core.domain.models import EntitlementClaims
from zeus_platform_core.security import ClaimsDep, ContainerDep, TenantIdDep

router = APIRouter(prefix="/entitlements", tags=["entitlements"])


@router.get("/me", response_model=EntitlementClaims)
async def my_entitlements(claims: ClaimsDep) -> EntitlementClaims:
    """The tenant's full access snapshot (cached)."""
    return claims


@router.post("/refresh", response_model=EntitlementClaims)
async def refresh(container: ContainerDep, tenant_id: TenantIdDep) -> EntitlementClaims:
    """Force a recompute from the source of truth."""
    return await container.entitlements.refresh(tenant_id)
