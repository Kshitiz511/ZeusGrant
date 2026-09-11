"""Tests for email verification.

The code is only six digits, so nothing here relies on it being hard to guess.
What makes it safe is the attempt limit, the expiry, and the fact that
requesting a new code invalidates the old one -- so those are what these tests
pin down.
"""

from __future__ import annotations

import pytest
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.interfaces import EmailSender
from zeus_platform_core.repositories.tenants import TenantRepository
from zeus_platform_core.services.email_verification_service import (
    MAX_ATTEMPTS,
    MAX_SENDS_PER_HOUR,
    EmailVerificationService,
    VerificationError,
    _hash_code,
)

USER_ID = "22222222-2222-2222-2222-222222222222"
EMAIL = "user@example.com"


class RecordingEmail(EmailSender):
    """Captures messages so a test can read the code out of the body."""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def send(self, *, to: str, subject: str, text: str, html: str | None = None) -> None:
        self.sent.append({"to": to, "subject": subject, "text": text})

    @property
    def last_code(self) -> str:
        # The subject is "<code> is your Zeus verification code".
        return self.sent[-1]["subject"].split()[0]


def _service(db: FakeDatabase, email: EmailSender) -> EmailVerificationService:
    return EmailVerificationService(
        tenants=TenantRepository(db), email=email, ttl_minutes=15
    )


def _db(
    *,
    code_hash: str | None = None,
    attempts: int = 0,
    expires_in_minutes: int = 15,
    recent_sends: int = 0,
) -> FakeDatabase:
    from datetime import UTC, datetime, timedelta

    db = FakeDatabase()
    # Needles must be unique to one query. The first matching handler wins, and
    # several of these statements select from the same table, so key on the
    # select list rather than the FROM/WHERE lines.
    db.on_fetch_one(
        "SELECT id, code_hash, attempts",
        lambda args: (
            {
                "id": "v-1",
                "code_hash": code_hash,
                "attempts": attempts,
                "expires_at": datetime.now(UTC) + timedelta(minutes=expires_in_minutes),
            }
            if code_hash
            else None
        ),
    )
    db.on_fetch_one("RETURNING attempts", lambda args: {"attempts": attempts + 1})
    db.on_fetch_one("SELECT count(*) AS n", lambda args: {"n": recent_sends})
    return db


@pytest.mark.asyncio
async def test_a_correct_code_verifies_the_address():
    email = RecordingEmail()
    db = _db()
    await _service(db, email).send_code(user_id=USER_ID, email=EMAIL, full_name="Ada Lovelace")

    code = email.last_code
    assert code.isdigit() and len(code) == 6

    verified = _db(code_hash=_hash_code(code))
    await _service(verified, email).verify(user_id=USER_ID, code=code)
    assert any("email_verified_at" in sql for _kind, sql, _args in verified.calls)


@pytest.mark.asyncio
async def test_a_wrong_code_is_rejected_and_counted():
    email = RecordingEmail()
    db = _db(code_hash=_hash_code("111111"))
    with pytest.raises(VerificationError, match="incorrect"):
        await _service(db, email).verify(user_id=USER_ID, code="222222")
    # The attempt must be recorded even though the guess failed, or the limit
    # below could never be reached.
    assert any("attempts = attempts + 1" in sql for _kind, sql, _args in db.calls)


@pytest.mark.asyncio
async def test_attempts_are_capped():
    """Ten guesses at six digits is a 1-in-100,000 chance; unlimited is certain."""
    email = RecordingEmail()
    db = _db(code_hash=_hash_code("111111"), attempts=MAX_ATTEMPTS)
    with pytest.raises(VerificationError, match="Too many"):
        await _service(db, email).verify(user_id=USER_ID, code="111111")
    # Even the *right* code is refused once the row is spent, so an attacker
    # cannot simply keep going until they land on it.
    assert not any("email_verified_at" in sql for _kind, sql, _args in db.calls)


@pytest.mark.asyncio
async def test_an_expired_code_is_rejected():
    email = RecordingEmail()
    db = _db(code_hash=_hash_code("111111"), expires_in_minutes=-1)
    with pytest.raises(VerificationError, match="expired"):
        await _service(db, email).verify(user_id=USER_ID, code="111111")


@pytest.mark.asyncio
async def test_verifying_with_no_pending_code_is_rejected():
    email = RecordingEmail()
    with pytest.raises(VerificationError, match="No verification code"):
        await _service(_db(), email).verify(user_id=USER_ID, code="111111")


@pytest.mark.asyncio
async def test_sending_a_new_code_retires_the_previous_one():
    """Otherwise every resend adds another live code and the cap means nothing."""
    email = RecordingEmail()
    db = _db()
    await _service(db, email).send_code(user_id=USER_ID, email=EMAIL)
    assert any(
        "SET consumed_at = now()" in sql and "consumed_at IS NULL" in sql
        for _kind, sql, _args in db.calls
    )


@pytest.mark.asyncio
async def test_resends_are_rate_limited():
    """Each send costs money and lands in someone's inbox."""
    email = RecordingEmail()
    db = _db(recent_sends=MAX_SENDS_PER_HOUR)
    with pytest.raises(VerificationError, match="Too many"):
        await _service(db, email).send_code(user_id=USER_ID, email=EMAIL)
    assert email.sent == []


@pytest.mark.asyncio
async def test_the_plaintext_code_is_never_stored():
    """A database leak must not hand out working codes."""
    email = RecordingEmail()
    db = _db()
    await _service(db, email).send_code(user_id=USER_ID, email=EMAIL)
    code = email.last_code
    for _kind, _sql, args in db.calls:
        assert code not in [str(a) for a in args]
