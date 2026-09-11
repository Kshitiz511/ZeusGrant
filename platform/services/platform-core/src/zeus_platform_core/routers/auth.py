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

import logging

from fastapi import APIRouter, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from zeus_platform_core.container import Container
from zeus_platform_core.security import ContainerDep
from zeus_platform_core.services.auth_service import AuthError, EmailNotVerifiedError
from zeus_platform_core.services.email_verification_service import VerificationError
from zeus_platform_core.services.session_service import (
    IssuedSession,
    SessionError,
    SessionReuseError,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: str
    password: str
    full_name: str
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


class PendingVerificationResponse(BaseModel):
    """Signup succeeded, but the account is not usable yet."""

    status: str = "verification_required"
    user_id: str
    email: str


class VerifyRequest(BaseModel):
    user_id: str
    code: str


class ResendRequest(BaseModel):
    user_id: str


@router.post(
    "/signup",
    response_model=PendingVerificationResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def signup(body: SignupRequest, container: ContainerDep) -> PendingVerificationResponse:
    """Create the account and send a verification code.

    Returns 202, not 201, and deliberately issues no session: the address is
    unproven until the code comes back, and signing the user in here would
    make verification optional in practice.
    """
    try:
        pending = await container.auth_service.signup(
            email=body.email,
            password=body.password,
            full_name=body.full_name,
            workspace_name=body.workspace_name,
        )
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        await container.email_verification.send_code(
            user_id=pending["user_id"],
            email=pending["email"],
            full_name=pending.get("full_name"),
        )
    except Exception:
        # The account exists but the code did not go out. Say so plainly and
        # point at resend, rather than reporting a failure that would have the
        # user try to register again and hit "email already in use".
        logger.exception("auth.verification_send_failed user_id=%s", pending["user_id"])
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Account created, but the verification email could not be sent. "
            "Use 'Resend code' to try again.",
        ) from None

    return PendingVerificationResponse(user_id=pending["user_id"], email=pending["email"])


@router.post("/verify", response_model=SessionResponse)
async def verify_email(
    body: VerifyRequest, container: ContainerDep, request: Request, response: Response
) -> SessionResponse:
    """Confirm a code and issue the first session."""
    try:
        await container.email_verification.verify(user_id=body.user_id, code=body.code)
    except VerificationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    try:
        payload = await container.auth_service.session_for_user(body.user_id)
    except AuthError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return await _establish(container, request, response, payload)


@router.post("/verify/resend", status_code=status.HTTP_202_ACCEPTED)
async def resend_verification(body: ResendRequest, container: ContainerDep) -> dict:
    """Send a fresh code, superseding any previous one."""
    user = await container.tenants.get_user_by_id(body.user_id)
    # Always report success. A different answer for an unknown id would turn
    # this into a way to test whether an account exists.
    if user is None or user.get("email_verified_at") is not None:
        return {"status": "sent"}

    try:
        await container.email_verification.send_code(
            user_id=body.user_id,
            email=str(user["email"]),
            full_name=user.get("full_name"),
        )
    except VerificationError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(exc)
        ) from exc
    except Exception:
        logger.exception("auth.verification_resend_failed user_id=%s", body.user_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send the verification email. Try again shortly.",
        ) from None
    return {"status": "sent"}


@router.post("/login", response_model=SessionResponse)
async def login(
    body: LoginRequest, container: ContainerDep, request: Request, response: Response
) -> SessionResponse:
    try:
        payload = await container.auth_service.login(email=body.email, password=body.password)
    except EmailNotVerifiedError as exc:
        # 403, not 401: the credentials were right. The user id lets the client
        # jump straight to the verification screen with a working resend.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": str(exc),
                "status": "verification_required",
                "user_id": exc.user_id,
                "email": exc.email,
            },
        ) from exc
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


# --- Google Sign-In ---------------------------------------------------------


class AuthMethodsResponse(BaseModel):
    """What the login screen is allowed to offer.

    The console asks rather than assuming, because a half-configured Google
    integration fails at Google's redirect with an error page we cannot style
    or explain. Better to not show the button at all.
    """

    password: bool = True
    google: bool


@router.get("/methods", response_model=AuthMethodsResponse)
async def auth_methods(container: ContainerDep) -> AuthMethodsResponse:
    return AuthMethodsResponse(google=container.settings.auth.google_configured)


@router.get("/google/start")
async def google_start(container: ContainerDep) -> Response:
    """Redirect the browser to Google's consent screen."""
    if not container.settings.auth.google_configured:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google sign-in is not configured.",
        )
    url, _state = await container.google_oauth.begin()
    # 307 keeps the method, but this is a GET anyway; the point is that the
    # browser follows it and the state cookie is already stored server-side.
    return Response(status_code=status.HTTP_307_TEMPORARY_REDIRECT, headers={"Location": url})


@router.get("/google/callback")
async def google_callback(
    container: ContainerDep,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> Response:
    """Complete the Google flow and drop the user into the console.

    Returns a redirect rather than JSON: this URL is loaded by the browser as a
    top-level navigation, so the response has to be something a browser can
    render. Session cookies ride along on the redirect.
    """
    console_url = container.settings.auth.google_redirect_uri or "/"
    # Derive the app origin from the configured redirect so this works in local
    # dev and production without a second setting to keep in sync.
    origin = console_url.split("/api/")[0].split("/auth/")[0].rstrip("/") or ""

    def _fail(message: str) -> Response:
        from urllib.parse import quote

        return Response(
            status_code=status.HTTP_307_TEMPORARY_REDIRECT,
            headers={"Location": f"{origin}/login?error={quote(message)}"},
        )

    if error or not code or not state:
        # User pressed "cancel" on Google's screen, or the callback is malformed.
        return _fail("Google sign-in was cancelled.")

    from zeus_platform_core.services.google_oauth import GoogleAuthError

    try:
        profile = await container.google_oauth.complete(code=code, state=state)
        payload = await container.auth_service.signin_with_google(
            subject=profile.subject,
            email=profile.email,
            email_verified=profile.email_verified,
            full_name=profile.full_name,
        )
        issued = await container.sessions.issue(
            user_id=payload["user_id"],
            user_agent=request.headers.get("user-agent"),
            ip=_client_ip(request),
        )
    except (GoogleAuthError, AuthError) as exc:
        return _fail(str(exc))
    except Exception:
        # This URL is a top-level browser navigation, so an unhandled error
        # renders a raw server-error page in the middle of signing in, and in
        # debug mode that page is a stack trace. Log the detail and send the
        # user back to a form they can act on, with a message that reveals
        # nothing about the internals.
        logger.exception("Google sign-in failed unexpectedly")
        return _fail("Sign-in failed. Please try again.")

    response = Response(
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        headers={"Location": f"{origin}/"},
    )
    _set_session_cookies(response, container, issued)
    return response
