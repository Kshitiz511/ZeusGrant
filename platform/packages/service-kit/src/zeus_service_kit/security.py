"""Reusable auth + entitlement guard for module services.

A module service does not recompute entitlements; it reads the derived
snapshot the platform-core already produced. Fast path: the Redis claims
cache (`entitlements:{tenant_id}`) that EntitlementsService writes. Fallback:
the `platform.entitlements` table. Either way the module independently
verifies access before running any business logic — defense in depth, so a
gateway bug can never expose a module a tenant did not buy.
"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from zeus_adapters.db.tenant_context import bind_tenant
from zeus_adapters.interfaces import AuthProvider, Cache, Database
from zeus_adapters.models import Session

# Statuses that grant access. Mirrors platform-core ACCESS_GRANTING_STATUSES;
# kept as a literal set here so this package stays dependency-light.
_ACCESS_GRANTING = frozenset({"trialing", "active", "past_due"})

_CACHE_PREFIX = "entitlements:"

_bearer = HTTPBearer(auto_error=False, description="Supabase/GoTrue JWT")


def module_active(claims: dict, module_id: str) -> bool:
    """True if ``claims`` grants active access to ``module_id``."""
    ent = (claims.get("modules") or {}).get(module_id)
    return bool(ent) and ent.get("status") in _ACCESS_GRANTING


class ServiceSecurity:
    """Holds the shared adapters and produces FastAPI dependencies.

    Construct once per app (from the service container) and store on
    ``app.state``. The dependency factories read the instance off the request.
    """

    def __init__(self, *, auth: AuthProvider, cache: Cache, db: Database) -> None:
        self.auth = auth
        self.cache = cache
        self.db = db

    # --- claims resolution ---
    async def claims_for(self, tenant_id: str) -> dict:
        cached = await self.cache.get(f"{_CACHE_PREFIX}{tenant_id}")
        if cached is not None:
            return json.loads(cached)
        # Fallback: rebuild a minimal claims dict from the derived table.
        rows = await self.db.fetch(
            "SELECT module_id, status FROM platform.entitlements WHERE tenant_id = $1",
            tenant_id,
        )
        return {
            "tenant_id": tenant_id,
            "modules": {r["module_id"]: {"status": r["status"]} for r in rows},
        }


def _security(request: Request) -> ServiceSecurity:
    sec = getattr(request.app.state, "security", None)
    if sec is not None:
        return sec
    # Fall back to the service container, which builds security lazily. This
    # keeps app import cheap (no config needed) until the first guarded request.
    return request.app.state.container.security


SecurityDep = Annotated[ServiceSecurity, Depends(_security)]


async def get_session(
    security: SecurityDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Security(_bearer)] = None,
) -> Session:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return await security.auth.verify(credentials.credentials)
    except Exception as exc:  # noqa: BLE001 - normalize any verify failure to 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token."
        ) from exc


SessionDep = Annotated[Session, Depends(get_session)]


async def get_tenant_id(
    session: SessionDep,
    x_tenant_id: Annotated[str | None, Header()] = None,
) -> str:
    tenant_id = x_tenant_id or session.tenant_id
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No tenant context. Provide X-Tenant-Id or a tenant-scoped token.",
        )
    return tenant_id


TenantIdDep = Annotated[str, Depends(get_tenant_id)]


async def get_actor_id(session: SessionDep) -> str | None:
    """The authenticated user id, for audit attribution.

    Separate from the tenant guard so audit writes never influence access
    control, and so a missing user id degrades to an anonymous-but-recorded
    entry rather than failing the request.
    """
    return session.user_id or None


ActorDep = Annotated[str | None, Depends(get_actor_id)]


def require_module(module_id: str):
    """Dependency factory guarding a route to tenants entitled to ``module_id``."""

    async def _guard(security: SecurityDep, tenant_id: TenantIdDep) -> str:
        claims = await security.claims_for(tenant_id)
        if not module_active(claims, module_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This tenant is not subscribed to module '{module_id}'.",
            )
        # Bind the tenant for the rest of this request so the Postgres adapter
        # pins app.current_tenant and RLS policies enforce isolation in-database.
        bind_tenant(tenant_id)
        return tenant_id

    return _guard
