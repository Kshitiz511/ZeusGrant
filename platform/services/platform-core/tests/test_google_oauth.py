"""Tests for the Google OAuth handshake.

These use the **real** ``MemoryCache`` adapter rather than a permissive stub.
An earlier stub accepted any keyword, so a call passing ``ttl=`` instead of
``ttl_seconds=`` passed every test and then raised a ``TypeError`` the first
time the endpoint was hit for real. Exercising the shipped adapter is what
makes these tests able to catch that class of mistake.
"""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_platform_core.services.google_oauth import GoogleOAuthService


def _service(cache: MemoryCache) -> GoogleOAuthService:
    return GoogleOAuthService(
        client_id="test-client-id",
        client_secret="test-client-secret",
        redirect_uri="http://localhost:8000/api/core/auth/google/callback",
        cache=cache,
    )


@pytest.mark.asyncio
async def test_begin_builds_a_google_url_and_stores_the_state() -> None:
    cache = MemoryCache()
    url, state = await _service(cache).begin()

    parsed = urlparse(url)
    assert parsed.netloc == "accounts.google.com"

    params = parse_qs(parsed.query)
    assert params["client_id"] == ["test-client-id"]
    assert params["response_type"] == ["code"]
    assert params["state"] == [state]

    # The nonce travels to Google in the URL and is kept server-side under the
    # state key. The callback compares the two, which is what stops a token
    # minted for another login from being replayed into this one.
    stored = await cache.get(f"oauth:google:{state}")
    assert stored is not None
    assert params["nonce"] == [stored]


@pytest.mark.asyncio
async def test_each_begin_issues_a_fresh_state() -> None:
    cache = MemoryCache()
    service = _service(cache)
    _, first = await service.begin()
    _, second = await service.begin()

    # A reused state would let one captured callback be replayed.
    assert first != second
