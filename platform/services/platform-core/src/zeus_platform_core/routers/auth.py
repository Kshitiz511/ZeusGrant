"""Public auth endpoints: email/password signup and login.

Both return a user-level token plus the user's tenant list; the client then
exchanges it for a tenant-scoped token via POST /tenancy/token.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from zeus_platform_core.security import ContainerDep
from zeus_platform_core.services.auth_service import AuthError

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: str
    password: str
    workspace_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class SessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    tenants: list[dict]


@router.post("/signup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, container: ContainerDep) -> SessionResponse:
    try:
        payload = await container.auth_service.signup(
            email=body.email, password=body.password, workspace_name=body.workspace_name
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return SessionResponse(**payload)


@router.post("/login", response_model=SessionResponse)
async def login(body: LoginRequest, container: ContainerDep) -> SessionResponse:
    try:
        payload = await container.auth_service.login(email=body.email, password=body.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return SessionResponse(**payload)
