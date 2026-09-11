"""Refresh-token session lifecycle: issue, rotate, revoke.

This is what makes "stay logged in across a reload" safe. The access JWT is
still short-lived and memory-only; what survives the reload is an opaque
refresh token in an httpOnly cookie that script cannot read, backed by the
``platform.user_sessions`` table.

Three defences are layered here:

* **Hash at rest.** Only ``sha256(token)`` is stored, so a database leak yields
  nothing replayable.
* **Rotation.** Every refresh burns the presented token and issues a new one.
  A captured cookie is therefore useful only until the legitimate user next
  refreshes.
* **Reuse detection.** If an already-used token is presented well after it was
  rotated, the only explanations are theft or a cloned cookie, so the entire
  family is revoked and both parties are forced to log in again.

  A short leeway makes that check usable in practice. Two browser tabs
  restoring their session on the same cookie, a retried request, or a
  double-clicked button all replay a just-rotated token within milliseconds,
  and treating those as attacks logs honest users out constantly. Replay
  *outside* the window is still fatal to the family, which is where real theft
  lands: an attacker who captured a cookie has no reason to use it in the same
  breath as the legitimate client.

CSRF is handled by double submit: a second, script-readable cookie carries a
random value that the client must echo in the ``X-CSRF-Token`` header. A
cross-site attacker can cause the browser to *send* cookies but cannot read
them, so it cannot produce the matching header.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from zeus_platform_core.repositories.sessions import SessionRepository

# 32 bytes of urandom; brute force is not a consideration at this width.
_TOKEN_BYTES = 32


class SessionError(Exception):
    """The presented refresh session is missing, expired or malformed."""


class SessionReuseError(SessionError):
    """An already-rotated token was presented — treated as compromise."""


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _as_utc(value: datetime | None) -> datetime | None:
    """Normalise a database timestamp so comparisons cannot raise.

    Postgres returns timezone-aware values, but fakes and SQLite-style drivers
    return naive ones; treating those as UTC keeps the comparison total.
    """
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@dataclass(frozen=True)
class IssuedSession:
    """What the router needs to write cookies."""

    token: str
    csrf_token: str
    expires_at: datetime

    @property
    def max_age(self) -> int:
        remaining = int((self.expires_at - datetime.now(UTC)).total_seconds())
        return max(remaining, 0)


class SessionService:
    def __init__(
        self,
        *,
        sessions: SessionRepository,
        ttl_seconds: int,
        reuse_leeway_seconds: int = 15,
    ) -> None:
        self._sessions = sessions
        self._ttl = ttl_seconds
        self._leeway = timedelta(seconds=reuse_leeway_seconds)

    async def issue(
        self,
        *,
        user_id: str,
        family_id: str | None = None,
        expires_at: datetime | None = None,
        user_agent: str | None = None,
        ip: str | None = None,
    ) -> IssuedSession:
        """Start a new session, or extend an existing family during rotation.

        ``expires_at`` is passed through on rotation so a family keeps its
        original absolute deadline; a stolen cookie cannot be refreshed
        indefinitely into a permanent foothold.
        """
        token = secrets.token_urlsafe(_TOKEN_BYTES)
        csrf_token = secrets.token_urlsafe(_TOKEN_BYTES)
        deadline = expires_at or datetime.now(UTC) + timedelta(seconds=self._ttl)
        await self._sessions.create(
            session_id=str(uuid.uuid4()),
            family_id=family_id or str(uuid.uuid4()),
            user_id=user_id,
            token_hash=_hash(token),
            csrf_hash=_hash(csrf_token),
            expires_at=deadline,
            user_agent=(user_agent or "")[:512] or None,
            ip=ip,
        )
        return IssuedSession(token=token, csrf_token=csrf_token, expires_at=deadline)

    async def rotate(
        self,
        *,
        token: str | None,
        csrf_token: str | None,
        user_agent: str | None = None,
        ip: str | None = None,
    ) -> tuple[str, IssuedSession]:
        """Validate, burn and replace a refresh token. Returns (user_id, new)."""
        if not token:
            raise SessionError("No session cookie.")

        record = await self._sessions.get_by_token_hash(_hash(token))
        if record is None:
            raise SessionError("Unknown session.")

        family_id = str(record["family_id"])

        if record["revoked_at"] is not None:
            raise SessionError("Session revoked.")

        used_at = _as_utc(record["used_at"])
        concurrent = False
        if used_at is not None:
            if datetime.now(UTC) - used_at <= self._leeway:
                # Another tab or a retry rotated this token a moment ago. Issue
                # a fresh one rather than punishing the user for having the app
                # open twice.
                concurrent = True
            else:
                # Long after the legitimate client moved on, so whoever holds
                # this got it some other way. Kill the family.
                await self._sessions.revoke_family(family_id, "refresh token reuse detected")
                raise SessionReuseError("Session reuse detected; all sessions revoked.")

        expires_at = _as_utc(record["expires_at"])
        if expires_at is None or expires_at <= datetime.now(UTC):
            raise SessionError("Session expired.")

        # CSRF check happens only after we know the cookie is a real live
        # session, so a failure here is a genuine cross-site attempt.
        if not csrf_token or not hmac.compare_digest(_hash(csrf_token), record["csrf_hash"]):
            raise SessionError("Missing or invalid CSRF token.")

        if not concurrent and not await self._sessions.claim(str(record["id"])):
            # Someone claimed the row between our read and our write. That is
            # by definition simultaneous, so it is the same benign race as the
            # leeway case above rather than evidence of theft — fall through
            # and issue a token for it.
            concurrent = True

        issued = await self.issue(
            user_id=str(record["user_id"]),
            family_id=family_id,
            expires_at=expires_at,
            user_agent=user_agent,
            ip=ip,
        )
        return str(record["user_id"]), issued

    async def revoke(self, token: str | None) -> None:
        """Log out: revoke the whole family so sibling tabs die too.

        Deliberately silent on unknown tokens — logout must never fail and must
        not reveal whether a token was valid.
        """
        if not token:
            return
        record = await self._sessions.get_by_token_hash(_hash(token))
        if record is not None:
            await self._sessions.revoke_family(str(record["family_id"]), "logout")
