"""Email verification codes: issue, deliver, check.

A six-digit code sent to the address, rather than a magic link. Links are
mangled by corporate mail scanners that follow every URL they see -- which
would consume the token before the user ever clicks it -- and a code can be
typed on a different device to the one that opened the mail.

Six digits is only a million possibilities, so security rests on the
server-side attempt limit, not on the length of the code.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import UTC, datetime

from zeus_adapters.interfaces import EmailSender

from zeus_platform_core.repositories.tenants import TenantRepository

log = logging.getLogger(__name__)

# Ten guesses against a six-digit code is a 1-in-100,000 chance of a hit.
MAX_ATTEMPTS = 10
# Sends allowed per hour, counting the one at signup.
MAX_SENDS_PER_HOUR = 5


class VerificationError(Exception):
    """Raised for verification failures; the message is safe to show a user."""


def _hash_code(code: str) -> str:
    """Hash a code for storage.

    SHA-256 rather than scrypt: the input is a six-digit number, so a slow hash
    buys nothing against an attacker who can simply try all million. What
    actually protects the code is the attempt limit and the short expiry. The
    hash exists so a database leak does not hand out live codes.
    """
    return hashlib.sha256(code.encode()).hexdigest()


class EmailVerificationService:
    def __init__(
        self,
        *,
        tenants: TenantRepository,
        email: EmailSender,
        ttl_minutes: int = 15,
    ) -> None:
        self._tenants = tenants
        self._email = email
        self._ttl = ttl_minutes

    async def send_code(self, *, user_id: str, email: str, full_name: str | None = None) -> None:
        """Generate, store and deliver a fresh code."""
        recent = await self._tenants.count_recent_verifications(user_id, within_minutes=60)
        if recent >= MAX_SENDS_PER_HOUR:
            raise VerificationError(
                "Too many verification emails requested. Try again in an hour."
            )

        # secrets, not random: this value guards account access.
        code = f"{secrets.randbelow(1_000_000):06d}"
        await self._tenants.create_email_verification(
            user_id=user_id,
            email=email,
            code_hash=_hash_code(code),
            ttl_minutes=self._ttl,
        )

        greeting = f"Hi {full_name.split()[0]}," if full_name else "Hi,"
        await self._email.send(
            to=email,
            subject=f"{code} is your Zeus verification code",
            text=(
                f"{greeting}\n\n"
                f"Your verification code is {code}\n\n"
                f"It expires in {self._ttl} minutes.\n\n"
                "If you didn't create a Zeus account, you can ignore this email.\n"
            ),
        )
        log.info("auth.verification_sent user_id=%s", user_id)

    async def verify(self, *, user_id: str, code: str) -> None:
        """Check a submitted code and mark the address verified.

        Raises :class:`VerificationError` on any failure.
        """
        code = code.strip().replace(" ", "")
        record = await self._tenants.get_live_email_verification(user_id)
        if record is None:
            raise VerificationError("No verification code is pending. Request a new one.")

        if record["attempts"] >= MAX_ATTEMPTS:
            raise VerificationError("Too many incorrect attempts. Request a new code.")

        expires_at = record["expires_at"]
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=UTC)
        if expires_at < datetime.now(UTC):
            raise VerificationError("That code has expired. Request a new one.")

        # Count the attempt before comparing, so a crash mid-verify cannot be
        # used to get a free guess.
        attempts = await self._tenants.record_verification_attempt(str(record["id"]))

        # compare_digest: a plain == leaks how much of the code matched through
        # timing, which narrows a brute force considerably.
        if not hmac.compare_digest(_hash_code(code), record["code_hash"]):
            remaining = MAX_ATTEMPTS - attempts
            if remaining <= 0:
                raise VerificationError("Too many incorrect attempts. Request a new code.")
            raise VerificationError(
                f"That code is incorrect. {remaining} attempt"
                f"{'s' if remaining != 1 else ''} remaining."
            )

        await self._tenants.consume_email_verification(str(record["id"]))
        await self._tenants.mark_email_verified(user_id)
        log.info("auth.email_verified user_id=%s", user_id)
