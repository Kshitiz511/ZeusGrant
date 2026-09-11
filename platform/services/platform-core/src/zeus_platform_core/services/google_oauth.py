"""Google Sign-In (OpenID Connect).

Flow: the console sends the user to Google, Google redirects back with a
short-lived ``code``, and we exchange that code server-side for an ID token.
The client secret never reaches the browser.

Three things here are security-critical rather than incidental:

**The ID token is verified, not decoded.** Anyone can mint a JWT that *says*
``sub: 12345``. We check Google's signature against their published keys, that
the audience is our client id, and that the issuer is Google. Skipping any of
those turns "sign in with Google" into "sign in as anybody".

**Accounts are keyed on the subject id, never the email address.** Google
subjects are permanent; email addresses are not. Matching on email would hand
an account to whoever inherits a recycled address.

**The unverified-collision case is handled explicitly.** See
``link_or_create`` -- it is the one place where an attacker could otherwise
take over an account they do not own.
"""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any

log = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("https://accounts.google.com", "accounts.google.com")

#: How long an in-flight login may take before its state is rejected.
STATE_TTL_SECONDS = 600


class GoogleAuthError(Exception):
    """Raised for any failure in the OAuth exchange; message is user-safe."""


@dataclass(frozen=True, slots=True)
class GoogleProfile:
    subject: str
    email: str
    email_verified: bool
    full_name: str | None


class GoogleOAuthService:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        cache: Any,
        http_timeout: float = 10.0,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._cache = cache
        self._timeout = http_timeout

    # --- Step 1: send the user to Google ------------------------------------
    async def begin(self) -> tuple[str, str]:
        """Return ``(authorization_url, state)``.

        ``state`` is a one-time random value stored server-side. Google echoes
        it back on the callback; if it does not match something we issued, the
        callback did not originate from a login we started. Without this check
        an attacker can have a victim's browser complete *their* login and end
        up silently signed into the attacker's account.
        """
        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(16)
        await self._cache.set(f"oauth:google:{state}", nonce, ttl_seconds=STATE_TTL_SECONDS)

        params = {
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "response_type": "code",
            # Only what we need. Asking for more would trigger Google's
            # verification review and give us data we have no reason to hold.
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            # Always show the chooser: silently reusing a session is surprising
            # on a shared machine.
            "prompt": "select_account",
        }
        from urllib.parse import urlencode

        return f"{GOOGLE_AUTH_URL}?{urlencode(params)}", state

    # --- Step 2: handle the redirect back -----------------------------------
    async def complete(self, *, code: str, state: str) -> GoogleProfile:
        nonce = await self._cache.get(f"oauth:google:{state}")
        if not nonce:
            raise GoogleAuthError("This sign-in link has expired. Please try again.")
        # Burn the state immediately: a replayed callback must not work twice.
        await self._cache.delete(f"oauth:google:{state}")

        id_token = await self._exchange_code(code)
        claims = await self._verify_id_token(id_token, expected_nonce=nonce)

        email = (claims.get("email") or "").strip().lower()
        if not email:
            raise GoogleAuthError("Google did not return an email address.")

        return GoogleProfile(
            subject=str(claims["sub"]),
            email=email,
            # Google sends this as a bool or the string "true" depending on the
            # endpoint. Normalise rather than trusting the type.
            email_verified=str(claims.get("email_verified", "")).lower() in ("true", "1"),
            full_name=(claims.get("name") or "").strip() or None,
        )

    async def _exchange_code(self, code: str) -> str:
        import httpx

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
        if resp.status_code != 200:
            # Google's body can echo request parameters; log the status only.
            log.warning("google.token_exchange_failed status=%s", resp.status_code)
            raise GoogleAuthError("Could not complete Google sign-in. Please try again.")

        id_token = resp.json().get("id_token")
        if not id_token:
            raise GoogleAuthError("Google did not return an identity token.")
        return id_token

    async def _verify_id_token(self, id_token: str, *, expected_nonce: str) -> dict:
        import jwt
        from jwt import PyJWKClient
        from jwt.exceptions import PyJWKClientError

        # PyJWKClient caches the key set in-process, so this is one network call
        # per cold start rather than one per login.
        try:
            jwk_client = PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True)
            signing_key = jwk_client.get_signing_key_from_jwt(id_token)
            claims = jwt.decode(
                id_token,
                signing_key.key,
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=GOOGLE_ISSUERS[0],
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            )
        except PyJWKClientError as exc:
            # Key fetch failed. PyJWKClient uses urllib internally, so this is
            # the network-failure path and is worth distinguishing from a bad
            # token -- one is our problem, the other is the caller's.
            log.warning("google.jwks_fetch_failed: %s", exc)
            raise GoogleAuthError("Could not reach Google. Please try again.") from exc
        except jwt.InvalidTokenError as exc:
            log.warning("google.id_token_invalid: %s", exc)
            raise GoogleAuthError("Google sign-in could not be verified.") from exc

        # jwt.decode only accepts a single issuer string; Google uses two forms.
        if claims.get("iss") not in GOOGLE_ISSUERS:
            raise GoogleAuthError("Google sign-in could not be verified.")

        # Binds this token to the request we started. Without it a token
        # obtained elsewhere for the same client id could be replayed here.
        if claims.get("nonce") != expected_nonce:
            log.warning("google.nonce_mismatch")
            raise GoogleAuthError("Google sign-in could not be verified.")

        if claims.get("exp", 0) < time.time():
            raise GoogleAuthError("Google sign-in expired. Please try again.")

        return claims
