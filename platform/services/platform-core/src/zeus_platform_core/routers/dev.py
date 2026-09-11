"""Developer-only endpoints, enabled by ZEUS_DEV_TOKENS=true.

For local exploration (Swagger, curl) only; MUST stay disabled in production.
The router refuses to mint tokens unless the flag is set, and app wiring only
mounts it when the flag is on — defense in depth.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from zeus_platform_core.security import ContainerDep

router = APIRouter(prefix="/dev", tags=["dev"])


class TokenRequest(BaseModel):
    user_id: str = Field(default="dev-user")
    tenant_id: str = Field(default="dev-tenant")
    roles: list[str] = Field(default_factory=list)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/token", response_model=TokenResponse)
async def mint_token(body: TokenRequest, container: ContainerDep) -> TokenResponse:
    """Mint a signed JWT for the given tenant/roles so you can click
    'Authorize' in Swagger and exercise protected routes locally."""
    settings = container.settings
    # Three independent guards, because this endpoint is a complete auth
    # bypass if it ever ships: settings validation refuses to boot production
    # with the flag on, app wiring only mounts the router when the flag is on,
    # and this check catches the case where the router is mounted directly
    # (a test, or a future refactor that forgets the wiring rule).
    if settings.is_production or not settings.dev_tokens_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    token = await container.auth.issue_claims(body.user_id, body.tenant_id, body.roles)
    return TokenResponse(access_token=token)
