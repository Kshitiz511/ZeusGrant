"""Tenancy endpoints: provision and list the caller's tenants."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from zeus_platform_core.security import ContainerDep, SessionDep

router = APIRouter(prefix="/tenancy", tags=["tenancy"])


class ProvisionRequest(BaseModel):
    tenant_name: str | None = None


class TenantOut(BaseModel):
    id: str
    name: str
    slug: str
    role: str


class TokenRequest(BaseModel):
    tenant_id: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    tenant_id: str
    role: str


@router.post("/provision", response_model=TenantOut)
async def provision(
    body: ProvisionRequest, container: ContainerDep, session: SessionDep
) -> TenantOut:
    """Create a tenant owned by the caller (or return their first one)."""
    tenant = await container.tenancy.ensure_tenant(
        user_id=session.user_id, email=session.email or ""
    )
    return TenantOut(id=tenant.id, name=tenant.name, slug=tenant.slug, role="owner")


@router.get("/mine")
async def my_tenants(container: ContainerDep, session: SessionDep) -> list[dict]:
    return await container.tenants.list_user_tenants(session.user_id)


@router.post("/token", response_model=TokenResponse)
async def exchange_token(
    body: TokenRequest, container: ContainerDep, session: SessionDep
) -> TokenResponse:
    """Exchange an authenticated session for a **tenant-scoped** token.

    The caller must be a member of ``tenant_id``. The returned JWT carries the
    tenant claim and the caller's role, so module services get proper tenant
    context without an ``X-Tenant-Id`` header. This is the round-trip that
    turns "logged-in user" into "acting within a specific tenant".
    """
    role = await container.tenants.get_membership_role(
        tenant_id=body.tenant_id, user_id=session.user_id
    )
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this tenant.",
        )
    roles = sorted({role, *session.roles})
    token = await container.auth.issue_claims(session.user_id, body.tenant_id, roles)
    return TokenResponse(
        access_token=token, tenant_id=body.tenant_id, role=role
    )
