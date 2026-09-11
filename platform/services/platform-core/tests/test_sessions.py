"""Refresh-token session rules: rotation, reuse detection, CSRF, expiry.

These are the properties that make a persistent login safe, so they are pinned
against an in-memory repository rather than only exercised end to end.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from zeus_platform_core.services.session_service import (
    SessionError,
    SessionReuseError,
    SessionService,
)

USER_ID = "33333333-3333-3333-3333-333333333333"


class FakeSessionRepo:
    """Mirrors SessionRepository semantics, including the atomic claim."""

    def __init__(self) -> None:
        self.rows: dict[str, dict] = {}

    async def create(self, **kw) -> None:
        self.rows[kw["token_hash"]] = {
            "id": kw["session_id"],
            "family_id": kw["family_id"],
            "user_id": kw["user_id"],
            "csrf_hash": kw["csrf_hash"],
            "expires_at": kw["expires_at"],
            "used_at": None,
            "revoked_at": None,
        }

    async def get_by_token_hash(self, token_hash: str) -> dict | None:
        return self.rows.get(token_hash)

    async def claim(self, session_id: str) -> bool:
        for row in self.rows.values():
            if row["id"] == session_id and row["used_at"] is None and row["revoked_at"] is None:
                row["used_at"] = datetime.now(UTC)
                return True
        return False

    async def revoke_family(self, family_id: str, reason: str) -> None:
        for row in self.rows.values():
            if row["family_id"] == family_id and row["revoked_at"] is None:
                row["revoked_at"] = datetime.now(UTC)

    def live_count(self) -> int:
        return sum(1 for r in self.rows.values() if r["revoked_at"] is None)


def _service(
    repo: FakeSessionRepo, ttl_seconds: int = 3600, reuse_leeway_seconds: int = 15
) -> SessionService:
    return SessionService(
        sessions=repo,
        ttl_seconds=ttl_seconds,
        reuse_leeway_seconds=reuse_leeway_seconds,
    )


async def test_issue_stores_only_hashes():
    repo = FakeSessionRepo()
    issued = await _service(repo).issue(user_id=USER_ID)
    # The raw token must never appear as a key or value in storage.
    assert issued.token not in repo.rows
    assert all(issued.token != v.get("csrf_hash") for v in repo.rows.values())
    assert issued.csrf_token != issued.token
    assert len(repo.rows) == 1


async def test_refresh_rotates_the_token():
    repo = FakeSessionRepo()
    svc = _service(repo)
    first = await svc.issue(user_id=USER_ID)

    user_id, second = await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    assert user_id == USER_ID
    assert second.token != first.token
    assert second.csrf_token != first.csrf_token


async def test_rotation_keeps_the_original_deadline():
    """A stolen cookie must not be refreshable into a permanent foothold."""
    repo = FakeSessionRepo()
    svc = _service(repo)
    first = await svc.issue(user_id=USER_ID)
    _, second = await svc.rotate(token=first.token, csrf_token=first.csrf_token)
    assert second.expires_at == first.expires_at


async def test_concurrent_refresh_is_not_treated_as_theft():
    """Two tabs restoring at once must not log the user out.

    This is the common real-world case: every tab calls /auth/refresh on mount
    with the same cookie. Punishing it makes a multi-tab user unusable.
    """
    repo = FakeSessionRepo()
    svc = _service(repo)
    first = await svc.issue(user_id=USER_ID)

    _, tab_a = await svc.rotate(token=first.token, csrf_token=first.csrf_token)
    # Second tab still holds the pre-rotation cookie.
    _, tab_b = await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    assert tab_a.token != tab_b.token
    assert repo.live_count() > 0


async def test_replay_after_the_leeway_revokes_the_whole_family():
    repo = FakeSessionRepo()
    svc = _service(repo, reuse_leeway_seconds=0)
    first = await svc.issue(user_id=USER_ID)
    await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    with pytest.raises(SessionReuseError):
        await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    # Both the burnt token and its live successor are dead.
    assert repo.live_count() == 0


async def test_stale_replay_is_detected_even_with_a_leeway():
    """An old capture is still fatal; only near-simultaneous use is forgiven."""
    repo = FakeSessionRepo()
    svc = _service(repo, reuse_leeway_seconds=15)
    first = await svc.issue(user_id=USER_ID)
    await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    # Backdate the rotation well outside the window.
    for row in repo.rows.values():
        if row["used_at"] is not None:
            row["used_at"] = datetime.now(UTC) - timedelta(minutes=5)

    with pytest.raises(SessionReuseError):
        await svc.rotate(token=first.token, csrf_token=first.csrf_token)
    assert repo.live_count() == 0


async def test_successor_is_unusable_after_reuse_detection():
    repo = FakeSessionRepo()
    svc = _service(repo, reuse_leeway_seconds=0)
    first = await svc.issue(user_id=USER_ID)
    _, second = await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    with pytest.raises(SessionReuseError):
        await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    with pytest.raises(SessionError):
        await svc.rotate(token=second.token, csrf_token=second.csrf_token)


async def test_missing_or_wrong_csrf_token_is_rejected():
    repo = FakeSessionRepo()
    svc = _service(repo)
    issued = await svc.issue(user_id=USER_ID)

    with pytest.raises(SessionError):
        await svc.rotate(token=issued.token, csrf_token=None)
    with pytest.raises(SessionError):
        await svc.rotate(token=issued.token, csrf_token="not-the-right-value")

    # A failed CSRF check must not burn the session — the real user is fine.
    user_id, _ = await svc.rotate(token=issued.token, csrf_token=issued.csrf_token)
    assert user_id == USER_ID


async def test_unknown_and_missing_tokens_are_rejected():
    svc = _service(FakeSessionRepo())
    with pytest.raises(SessionError):
        await svc.rotate(token=None, csrf_token="x")
    with pytest.raises(SessionError):
        await svc.rotate(token="never-issued", csrf_token="x")


async def test_expired_session_is_rejected():
    repo = FakeSessionRepo()
    svc = _service(repo)
    issued = await svc.issue(
        user_id=USER_ID, expires_at=datetime.now(UTC) - timedelta(seconds=1)
    )
    with pytest.raises(SessionError):
        await svc.rotate(token=issued.token, csrf_token=issued.csrf_token)


async def test_logout_revokes_every_session_in_the_family():
    repo = FakeSessionRepo()
    svc = _service(repo)
    first = await svc.issue(user_id=USER_ID)
    await svc.rotate(token=first.token, csrf_token=first.csrf_token)

    await svc.revoke(first.token)

    assert repo.live_count() == 0


async def test_logout_is_silent_for_unknown_tokens():
    """Logout must never fail, and must not reveal whether a token was real."""
    svc = _service(FakeSessionRepo())
    await svc.revoke(None)
    await svc.revoke("never-issued")
