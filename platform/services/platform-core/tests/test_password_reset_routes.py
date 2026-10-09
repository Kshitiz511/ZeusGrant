"""HTTP contract for password reset.

The service rules (hashing, attempt cap, expiry, superseding) are pinned in
``test_email_verification.py``. This file pins what the routes promise:
``/forgot`` never reveals whether an account exists, and ``/reset`` only
changes the password after a valid code -- and then signs out every session.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.services.auth_service import verify_password
from zeus_platform_core.services.email_verification_service import VerificationError

USER = {"id": "u-1", "email": "ada@example.com", "full_name": "Ada", "email_verified_at": None}


class Spy:
    def __init__(self) -> None:
        self.sent: list[str] = []
        self.password_hash: str | None = None
        self.revoked: list[tuple[str, str]] = []
        self.code_ok = True
        self.send_raises: Exception | None = None


@pytest.fixture
def spy_client() -> Iterator[tuple[TestClient, Spy]]:
    spy = Spy()
    container = Container(db=FakeDatabase(), cache=MemoryCache())

    async def get_user_by_email(email: str) -> dict | None:
        return USER if email == USER["email"] else None

    async def set_password_hash(user_id: str, password_hash: str) -> None:
        spy.password_hash = password_hash

    async def send_reset_code(**kwargs: Any) -> None:
        if spy.send_raises:
            raise spy.send_raises
        spy.sent.append(kwargs["email"])

    async def check_reset_code(*, user_id: str, code: str) -> None:
        if not spy.code_ok:
            raise VerificationError("That code is incorrect. 9 attempts remaining.")

    async def revoke_all_for_user(user_id: str, reason: str) -> None:
        spy.revoked.append((user_id, reason))

    container.tenants.get_user_by_email = get_user_by_email  # type: ignore[method-assign]
    container.tenants.set_password_hash = set_password_hash  # type: ignore[method-assign]
    container.email_verification.send_reset_code = send_reset_code  # type: ignore[method-assign]
    container.email_verification.check_reset_code = check_reset_code  # type: ignore[method-assign]
    container.session_repo.revoke_all_for_user = revoke_all_for_user  # type: ignore[method-assign]
    with TestClient(create_app(container)) as client:
        yield client, spy


def test_forgot_answers_identically_for_known_and_unknown_addresses(spy_client) -> None:
    client, spy = spy_client
    known = client.post("/auth/password/forgot", json={"email": "ADA@example.com "})
    unknown = client.post("/auth/password/forgot", json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert spy.sent == ["ada@example.com"]


@pytest.mark.parametrize(
    "error", [VerificationError("Too many codes requested."), RuntimeError("smtp down")]
)
def test_forgot_hides_rate_limits_and_delivery_failures(spy_client, error) -> None:
    """A distinct 429 or 502 would only ever appear for real accounts."""
    client, spy = spy_client
    spy.send_raises = error
    response = client.post("/auth/password/forgot", json={"email": USER["email"]})
    assert response.status_code == 202


def test_reset_with_valid_code_sets_password_and_revokes_sessions(spy_client) -> None:
    client, spy = spy_client
    response = client.post(
        "/auth/password/reset",
        json={"email": USER["email"], "code": "123456", "password": "new-password-1"},
    )
    assert response.status_code == 200
    assert spy.password_hash and verify_password("new-password-1", spy.password_hash)
    assert spy.revoked == [("u-1", "password_reset")]


def test_reset_with_wrong_code_changes_nothing(spy_client) -> None:
    client, spy = spy_client
    spy.code_ok = False
    response = client.post(
        "/auth/password/reset",
        json={"email": USER["email"], "code": "000000", "password": "new-password-1"},
    )
    assert response.status_code == 400
    assert spy.password_hash is None
    assert spy.revoked == []


def test_reset_for_unknown_address_is_a_plain_400(spy_client) -> None:
    client, spy = spy_client
    response = client.post(
        "/auth/password/reset",
        json={"email": "nobody@example.com", "code": "123456", "password": "new-password-1"},
    )
    assert response.status_code == 400
    assert spy.password_hash is None


def test_reset_rejects_a_short_password_before_spending_the_code(spy_client) -> None:
    client, spy = spy_client
    response = client.post(
        "/auth/password/reset",
        json={"email": USER["email"], "code": "123456", "password": "short"},
    )
    assert response.status_code == 400
    assert spy.password_hash is None
