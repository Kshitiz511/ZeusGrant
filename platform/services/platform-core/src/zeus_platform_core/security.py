"""Security dependencies: authentication and the entitlement guard.

The guard is the core selling mechanic — it blocks requests to a module a
tenant has not purchased *before* any service logic runs (architecture.md §1.3).
Services re-check and the DB enforces RLS, giving defense in depth.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from zeus_adapters.models import Session

from zeus_platform_core.container import Container
from zeus_platform_core.domain.models import EntitlementClaims

# auto_error=False so a missing token normalizes to 401 (not 403) while still
# advertising the scheme in OpenAPI (renders the Swagger "Authorize" button).
_bearer = HTTPBearer(auto_error=False, description="Supabase/GoTrue JWT")


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


async def get_session(
    container: ContainerDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)] = None,
) -> Session:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return await container.auth.verify(credentials.credentials)
    except Exception as exc:  # noqa: BLE001 - normalize any verify failure to 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token."
        ) from exc


SessionDep = Annotated[Session, Depends(get_session)]


async def get_tenant_id(
    session: SessionDep,
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> str:
    """Resolve the active tenant: explicit header wins, else the session claim."""
    tenant_id = x_tenant_id or session.tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tenant context. Provide X-Tenant-Id or a tenant-scoped token.",
        )
    return tenant_id


TenantIdDep = Annotated[str, Depends(get_tenant_id)]


async def get_claims(container: ContainerDep, tenant_id: TenantIdDep) -> EntitlementClaims:
    return await container.entitlements.get_claims(tenant_id)


ClaimsDep = Annotated[EntitlementClaims, Depends(get_claims)]


def require_module(module_id: str):
    """Dependency factory: guard a route so only tenants entitled to
    ``module_id`` may proceed. Returns the claims for downstream use."""

    async def _guard(claims: ClaimsDep) -> EntitlementClaims:
        if not claims.has_module(module_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This tenant is not subscribed to module '{module_id}'.",
            )
        return claims

    return _guard


PLATFORM_ADMIN_ROLE = "platform_admin"


async def require_platform_admin(session: SessionDep) -> Session:
    """Guard platform-wide admin routes (LLM keys, prompts, pricing)."""
    if PLATFORM_ADMIN_ROLE not in session.roles:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin privilege required.",
        )
    return session


AdminDep = Annotated[Session, Depends(require_platform_admin)]
