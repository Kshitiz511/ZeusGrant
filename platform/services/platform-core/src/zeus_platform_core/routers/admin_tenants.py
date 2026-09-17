"""Platform-admin tenant control: list, inspect, suspend, and override limits.

This is the operator's view across every tenant. Everything here is guarded by
``AdminDep`` and therefore runs with no tenant bound, which is what lets these
queries cross tenant boundaries at all -- every RLS policy in ``platform`` has a
"no tenant bound" branch precisely for this path.

---------------------------------------------------------------------------
WHAT SUSPENSION DOES, AND DELIBERATELY DOES NOT DO
---------------------------------------------------------------------------
Suspending a tenant flips ``tenants.status`` and invalidates its cached
entitlements. From the next request onward the tenant is entitled to nothing,
because ``compute_claims`` returns an empty snapshot for a non-active tenant,
and ``get_membership_role`` already refuses to hand out a tenant-scoped token
for a non-active tenant.

Work that is **already queued keeps running to completion.** The job worker
authenticates with a shared secret and claims work from its own ledger; it never
consults entitlements. That is intentional. A customer who submitted a job while
in good standing should get the result, and tearing down half-finished work
leaves documents in a state nobody can explain. Suspension stops new work; it is
not a kill switch for work in flight.

Suspension never touches subscriptions. It is an access decision, not a billing
one, so reactivating restores exactly what the tenant had.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from zeus_platform_core.routers.admin_audit import audit_action
from zeus_platform_core.security import AdminDep, ContainerDep

router = APIRouter(prefix="/admin/tenants", tags=["admin"])

#: The statuses an operator may set through the API. ``deleted`` is permitted by
#: the column's CHECK constraint but is not offered here: deletion has to deal
#: with data retention and Stripe cancellation, and a status flip that only
#: *looks* like a delete would be worse than having no delete at all.
SettableStatus = Literal["active", "suspended"]


class StatusUpdate(BaseModel):
    status: SettableStatus
    # Free text, required, because "why is this customer suspended" is the first
    # question anyone asks and the only moment it is reliably known is now.
    reason: str = Field(min_length=1, max_length=500)


class LimitOverrideSet(BaseModel):
    # None means explicitly unlimited. That is not the same as deleting the
    # override, which falls back to whatever the plan says.
    limit_value: int | None = Field(default=None, ge=0)
    reason: str = Field(min_length=1, max_length=500)


def _tenant_summary(tenant) -> dict:
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "status": tenant.status,
        "owner_user_id": tenant.owner_user_id,
        "stripe_customer_id": tenant.stripe_customer_id,
    }


@router.get("")
async def list_tenants(
    container: ContainerDep,
    admin: AdminDep,
    status: str | None = Query(default=None, pattern="^(active|suspended|deleted)$"),
    search: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    """Every tenant, newest first, with enough context to triage without drilling in.

    ``total`` is returned alongside the page so the UI can show real pagination
    instead of the "next" button that is always enabled and sometimes lies.
    """
    rows = await container.tenants.list_tenants(
        status=status, search=search, limit=limit, offset=offset
    )
    total = await container.tenants.count_tenants(status=status, search=search)
    return {"tenants": rows, "total": total, "limit": limit, "offset": offset}


@router.get("/{tenant_id}")
async def get_tenant(tenant_id: str, container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    """One tenant in full: members, subscriptions, overrides and resolved access.

    ``entitlements`` is recomputed rather than read from cache. An operator
    opening this page is usually trying to work out why a customer cannot do
    something, and showing them a snapshot that may be up to five minutes stale
    would send them chasing a problem that has already been fixed.
    """
    tenant = await container.tenants.get_by_id(tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="tenant not found")

    members = await container.tenants.list_members(tenant_id)
    subs = await container.subscriptions.list_by_tenant(tenant_id)
    overrides = await container.tenants.list_limit_overrides(tenant_id)
    claims = await container.entitlements.get_claims(tenant_id, use_cache=False)

    return {
        "tenant": _tenant_summary(tenant),
        "members": members,
        "subscriptions": [s.model_dump(mode="json") for s in subs],
        "limit_overrides": overrides,
        "entitlements": claims.model_dump(mode="json"),
    }


@router.post("/{tenant_id}/status")
async def set_tenant_status(
    tenant_id: str,
    body: StatusUpdate,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Suspend or reactivate a tenant.

    The cache is invalidated *and* recomputed rather than left to expire. The
    entitlements TTL is 300 seconds, so without this a suspended tenant would
    keep working for up to five minutes after an operator cut them off, and the
    operator would reasonably conclude the button was broken.

    Order matters: write the status first, then invalidate, then recompute. If
    the recompute were first it would race with the write and could repopulate
    the cache with the pre-suspension snapshot.
    """
    changed = await container.tenants.set_status(tenant_id, body.status)
    if changed is None:
        raise HTTPException(status_code=404, detail="tenant not found")

    await container.entitlements.invalidate(tenant_id)
    claims = await container.entitlements.refresh(tenant_id)

    await audit_action(
        container,
        request,
        admin,
        "tenant.status.set",
        target_type="tenant",
        target_id=tenant_id,
        before={"status": changed["previous_status"]},
        after={"status": changed["status"], "reason": body.reason},
    )
    return {
        "tenant_id": tenant_id,
        "previous_status": changed["previous_status"],
        "status": changed["status"],
        "active_modules": sorted(claims.modules),
    }


@router.get("/{tenant_id}/limits")
async def list_tenant_limits(
    tenant_id: str, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    """Current overrides plus the keys that may be overridden.

    ``available_keys`` is the union of limit keys across *all* plans, not just
    the ones this tenant is on. That is deliberate: it allows granting a limit
    ahead of the tenant buying the plan that normally carries it, while still
    refusing free-text keys that would create a row nothing ever reads.
    """
    tenant = await container.tenants.get_by_id(tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="tenant not found")

    catalog = await container.plans.limit_catalog()
    available = sorted({key for limits in catalog.values() for key in limits})
    return {
        "tenant_id": tenant_id,
        "overrides": await container.tenants.list_limit_overrides(tenant_id),
        "available_keys": available,
    }


@router.put("/{tenant_id}/limits/{limit_key}")
async def set_tenant_limit(
    tenant_id: str,
    limit_key: str,
    body: LimitOverrideSet,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Give one tenant a different ceiling for one limit.

    Unknown keys are rejected. A typo would otherwise write a row that resolves
    against nothing, and the operator would believe they had granted something
    they had not -- the worst kind of failure, because it is silent and looks
    like success.
    """
    tenant = await container.tenants.get_by_id(tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="tenant not found")

    catalog = await container.plans.limit_catalog()
    known = {key for limits in catalog.values() for key in limits}
    if limit_key not in known:
        raise HTTPException(
            status_code=400,
            detail=f"unknown limit key '{limit_key}'; known keys: {sorted(known)}",
        )

    result = await container.tenants.set_limit_override(
        tenant_id=tenant_id,
        limit_key=limit_key,
        limit_value=body.limit_value,
        reason=body.reason,
        set_by=admin.user_id,
    )
    if result is None:  # pragma: no cover - upsert always returns a row
        raise HTTPException(status_code=500, detail="override write returned no row")

    await container.entitlements.invalidate(tenant_id)
    await container.entitlements.refresh(tenant_id)

    await audit_action(
        container,
        request,
        admin,
        "tenant.limit.set",
        target_type="tenant",
        target_id=tenant_id,
        before=(
            {"limit_key": limit_key, "limit_value": result["previous_value"]}
            if result["existed"]
            else None
        ),
        after={"limit_key": limit_key, "limit_value": body.limit_value, "reason": body.reason},
    )
    return {
        "tenant_id": tenant_id,
        "limit_key": limit_key,
        "limit_value": result["limit_value"],
        "created": not result["existed"],
    }


@router.delete("/{tenant_id}/limits/{limit_key}")
async def clear_tenant_limit(
    tenant_id: str,
    limit_key: str,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Drop an override so the limit falls back to the tenant's plan."""
    removed = await container.tenants.clear_limit_override(
        tenant_id=tenant_id, limit_key=limit_key
    )
    if removed is None:
        raise HTTPException(status_code=404, detail="override not found")

    await container.entitlements.invalidate(tenant_id)
    await container.entitlements.refresh(tenant_id)

    await audit_action(
        container,
        request,
        admin,
        "tenant.limit.cleared",
        target_type="tenant",
        target_id=tenant_id,
        before={"limit_key": limit_key, "limit_value": removed["limit_value"]},
        after=None,
    )
    return {"tenant_id": tenant_id, "limit_key": limit_key, "cleared": True}
