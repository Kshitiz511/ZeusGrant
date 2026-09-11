"""Public auth endpoints: signup, login, refresh and logout.

Signup and login return a short-lived, user-level access token *and* set an
httpOnly refresh cookie. The client exchanges the access token for a
tenant-scoped one via POST /tenancy/token, and calls POST /auth/refresh on
startup (or after a 401) to get a new one without re-entering a password.

The access token is never persisted by the browser; only the opaque refresh
token is, and it lives in a cookie script cannot read. See
``services/session_service.py`` for the rotation and reuse-detection rules.
"""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from zeus_platform_core.container import Container
from zeus_platform_core.security import ContainerDep
from zeus_platform_core.services.auth_service import AuthError
from zeus_platform_core.services.session_service import (
    IssuedSession,
    SessionError,
    SessionReuseError,
)

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
    # Echoed back in the X-CSRF-Token header on refresh. Also delivered as a
    # readable cookie so a freshly loaded page can recover it before it holds
    # any access token at all.
    csrf_token: str


def _client_ip(request: Request) -> str | None:
    # Behind nginx the socket peer is the proxy, so prefer the forwarded
    # chain's first hop. Recorded for audit only, never for access decisions,
    # because X-Forwarded-For is client-controlled.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip() or None
    return request.client.host if request.client else None


def _set_session_cookies(response: Response, container: Container, issued: IssuedSession) -> None:
    cfg = container.settings.session
    common = {
        "domain": cfg.cookie_domain,
        "path": cfg.cookie_path,
        "secure": cfg.cookie_secure,
        "samesite": cfg.cookie_samesite,
        "max_age": issued.max_age,
    }
    response.set_cookie(cfg.cookie_name, issued.token, httponly=True, **common)
    # Intentionally readable: a double-submit CSRF value is useless to an
    # attacker who cannot read it, and useless to us if the client cannot.
    response.set_cookie(cfg.csrf_cookie_name, issued.csrf_token, httponly=False, **common)


def _clear_session_cookies(response: Response, container: Container) -> None:
    cfg = container.settings.session
    for name in (cfg.cookie_name, cfg.csrf_cookie_name):
        response.delete_cookie(name, path=cfg.cookie_path, domain=cfg.cookie_domain)


async def _establish(
    container: Container, request: Request, response: Response, payload: dict
) -> SessionResponse:
    issued = await container.sessions.issue(
        user_id=payload["user_id"],
        user_agent=request.headers.get("user-agent"),
        ip=_client_ip(request),
    )
    _set_session_cookies(response, container, issued)
    return SessionResponse(**payload, csrf_token=issued.csrf_token)


@router.post("/signup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignupRequest, container: ContainerDep, request: Request, response: Response
) -> SessionResponse:
    try:
        payload = await container.auth_service.signup(
            email=body.email, password=body.password, workspace_name=body.workspace_name
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return await _establish(container, request, response, payload)


@router.post("/login", response_model=SessionResponse)
async def login(
    body: LoginRequest, container: ContainerDep, request: Request, response: Response
) -> SessionResponse:
    try:
        payload = await container.auth_service.login(email=body.email, password=body.password)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
    return await _establish(container, request, response, payload)


@router.post("/refresh", response_model=SessionResponse)
async def refresh(
    container: ContainerDep,
    request: Request,
    response: Response,
    x_csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> SessionResponse:
    """Trade the refresh cookie for a new access token, rotating the cookie.

    Every failure mode returns 401 — expired, unknown, reused, missing CSRF.
    Distinguishing them would tell an attacker whether a stolen cookie was ever
    valid, and the client's only sane reaction is identical in all cases: show
    the login screen.
    """
    # Read the cookie off the request rather than via a ``Cookie`` parameter so
    # the configurable cookie name is actually honoured.
    cookie = request.cookies.get(container.settings.session.cookie_name)
    try:
        user_id, issued = await container.sessions.rotate(
            token=cookie,
            csrf_token=x_csrf_token,
            user_agent=request.headers.get("user-agent"),
            ip=_client_ip(request),
        )
    except SessionReuseError as exc:
        _clear_session_cookies(response, container)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session was revoked for security reasons. Please sign in again.",
        ) from exc
    except SessionError as exc:
        _clear_session_cookies(response, container)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired."
        ) from exc

    payload = await container.auth_service.session_for_user(user_id)
    _set_session_cookies(response, container, issued)
    return SessionResponse(**payload, csrf_token=issued.csrf_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(container: ContainerDep, request: Request, response: Response) -> Response:
    """Revoke the session family and clear the cookies.

    No CSRF check: a forced logout is an annoyance rather than a breach, and
    refusing to log someone out is the worse failure of the two.
    """
    await container.sessions.revoke(
        request.cookies.get(container.settings.session.cookie_name)
    )
    _clear_session_cookies(response, container)
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
