"""Tests for LLM resilience: retries, non-retryable errors, and the breaker."""

from __future__ import annotations

import asyncio

import pytest
from zeus_adapters.llm.resilient import (
    CircuitBreaker,
    LlmUnavailableError,
    ResilientLlmProvider,
    is_retryable,
)
from zeus_adapters.models import Completion, Message, Role


class FlakyProvider:
    """Fails `fail_times` times, then succeeds."""

    def __init__(self, fail_times: int = 0, exc: Exception | None = None) -> None:
        self.fail_times = fail_times
        self.calls = 0
        self._exc = exc or TimeoutError("upstream timeout")

    async def extract(self, schema, text, *, instructions=None):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self._exc
        return {"obligations": [{"description": "ok"}]}

    async def generate(self, messages, *, model=None, temperature=0.2):
        self.calls += 1
        if self.calls <= self.fail_times:
            raise self._exc
        return Completion(text="hi", model="test")

    async def embed(self, text):
        self.calls += 1
        return [0.0]


def _wrap(inner, **kwargs):
    # Zero delay keeps tests fast without changing the retry logic under test.
    kwargs.setdefault("base_delay", 0.0)
    kwargs.setdefault("max_delay", 0.0)
    return ResilientLlmProvider(inner, **kwargs)


async def test_retries_transient_failure_then_succeeds():
    inner = FlakyProvider(fail_times=2)
    provider = _wrap(inner, max_attempts=3)

    result = await provider.extract({}, "text")

    assert result["obligations"][0]["description"] == "ok"
    assert inner.calls == 3


async def test_gives_up_after_max_attempts():
    inner = FlakyProvider(fail_times=99)
    provider = _wrap(inner, max_attempts=3)

    with pytest.raises(LlmUnavailableError):
        await provider.extract({}, "text")

    assert inner.calls == 3


async def test_auth_errors_are_not_retried():
    """A bad API key fails identically every time; retrying only burns time."""
    inner = FlakyProvider(fail_times=99, exc=RuntimeError("AuthenticationError: invalid api key"))
    provider = _wrap(inner, max_attempts=5)

    with pytest.raises(RuntimeError, match="invalid api key"):
        await provider.extract({}, "text")

    assert inner.calls == 1


async def test_generate_and_embed_are_also_wrapped():
    inner = FlakyProvider(fail_times=1)
    provider = _wrap(inner, max_attempts=3)

    completion = await provider.generate([Message(role=Role.user, content="hi")])
    assert completion.text == "hi"

    inner.fail_times = 0
    assert await provider.embed("x") == [0.0]


async def test_circuit_opens_after_repeated_failures_and_fails_fast():
    inner = FlakyProvider(fail_times=99)
    provider = _wrap(inner, max_attempts=1, failure_threshold=2, recovery_seconds=60)

    for _ in range(2):
        with pytest.raises(LlmUnavailableError):
            await provider.extract({}, "text")

    calls_before = inner.calls

    # Circuit is now open: the next call must fail without touching the provider.
    with pytest.raises(LlmUnavailableError, match="temporarily unavailable"):
        await provider.extract({}, "text")

    assert inner.calls == calls_before


async def test_circuit_half_opens_after_recovery_window():
    inner = FlakyProvider(fail_times=2)
    provider = _wrap(inner, max_attempts=1, failure_threshold=2, recovery_seconds=0.05)

    for _ in range(2):
        with pytest.raises(LlmUnavailableError):
            await provider.extract({}, "text")

    await asyncio.sleep(0.06)

    # Provider has recovered; the trial call should succeed and close the circuit.
    result = await provider.extract({}, "text")
    assert result["obligations"][0]["description"] == "ok"

    result = await provider.extract({}, "text")
    assert result["obligations"]


async def test_non_retryable_error_does_not_open_the_circuit():
    """A malformed request is our fault, not evidence the provider is down."""
    inner = FlakyProvider(fail_times=99, exc=RuntimeError("BadRequest: invalid_request_error"))
    provider = _wrap(inner, max_attempts=1, failure_threshold=2)

    for _ in range(5):
        with pytest.raises(RuntimeError):
            await provider.extract({}, "text")

    assert not provider._breaker.is_open


def test_is_retryable_classification():
    assert is_retryable(TimeoutError())
    assert is_retryable(ConnectionError())
    assert is_retryable(RuntimeError("RateLimitError: slow down"))
    assert is_retryable(RuntimeError("500 internal server error"))

    assert not is_retryable(RuntimeError("AuthenticationError"))
    assert not is_retryable(RuntimeError("context_length_exceeded"))
    assert not is_retryable(RuntimeError("model_not_found"))
    assert not is_retryable(LlmUnavailableError("open"))


async def test_breaker_success_resets_failure_count():
    breaker = CircuitBreaker(failure_threshold=3, recovery_seconds=60)

    await breaker.record_failure()
    await breaker.record_failure()
    await breaker.record_success()
    await breaker.record_failure()
    await breaker.record_failure()

    # Only two failures since the success, so the circuit stays closed.
    assert not breaker.is_open
    await breaker.before_call()
