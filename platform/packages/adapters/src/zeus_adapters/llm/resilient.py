"""Resilience wrapper for :class:`LlmProvider`.

LLM APIs are the least reliable dependency in the system: they rate-limit,
time out, and occasionally return malformed JSON. This decorator wraps any
provider so every service inherits the same behaviour without duplicating it.

Two mechanisms, deliberately distinct:

* **Retry with exponential backoff + jitter** absorbs transient faults
  (429, 5xx, timeouts, connection resets). Jitter matters because without it
  every worker that failed at the same moment retries at the same moment.

* **Circuit breaker** (architecture.md §3) stops hammering a provider that is
  genuinely down. After ``failure_threshold`` consecutive failures the circuit
  opens and calls fail fast for ``recovery_seconds``; one trial call then
  decides whether to close it again. Without this, an outage turns every
  request into a slow failure and exhausts the worker pool.

Errors that are the *caller's* fault — bad key, malformed request, content
filtered — are never retried: retrying cannot help and it burns quota.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

from zeus_adapters.interfaces import LlmProvider
from zeus_adapters.models import Completion, Message

log = logging.getLogger(__name__)


class LlmUnavailableError(RuntimeError):
    """Raised when the provider is failing and the circuit is open.

    Distinct from a generic error so callers can map it to a 503 with a
    Retry-After rather than a 500.
    """


class CircuitBreaker:
    """Tracks consecutive failures and trips to fail fast when a provider dies."""

    def __init__(self, *, failure_threshold: int = 5, recovery_seconds: float = 30.0) -> None:
        self._failure_threshold = failure_threshold
        self._recovery_seconds = recovery_seconds
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = asyncio.Lock()

    @property
    def is_open(self) -> bool:
        return self._opened_at is not None

    async def before_call(self) -> None:
        """Raise if the circuit is open and the cooldown has not elapsed."""
        async with self._lock:
            if self._opened_at is None:
                return
            elapsed = time.monotonic() - self._opened_at
            if elapsed < self._recovery_seconds:
                raise LlmUnavailableError(
                    "The AI provider is temporarily unavailable. "
                    f"Retry in {self._recovery_seconds - elapsed:.0f}s."
                )
            # Cooldown elapsed: allow a single trial call through (half-open).
            # Success closes the circuit, failure re-opens it for another cycle.
            self._opened_at = None
            self._failures = self._failure_threshold - 1

    async def record_success(self) -> None:
        async with self._lock:
            self._failures = 0
            self._opened_at = None

    async def record_failure(self) -> None:
        async with self._lock:
            self._failures += 1
            if self._failures >= self._failure_threshold:
                self._opened_at = time.monotonic()
                log.warning(
                    "LLM circuit opened after %d consecutive failures", self._failures
                )


# Substrings identifying errors that will fail identically on every retry.
# Matched on the exception's text because each SDK raises its own types.
_NON_RETRYABLE = (
    "authenticationerror",
    "permissiondenied",
    "invalid_api_key",
    "invalid api key",
    "badrequest",
    "invalid_request_error",
    "content_filter",
    "context_length_exceeded",
    "model_not_found",
)


def is_retryable(exc: BaseException) -> bool:
    """True when retrying the same call could plausibly succeed."""
    if isinstance(exc, LlmUnavailableError):
        return False
    if isinstance(exc, asyncio.TimeoutError | ConnectionError):
        return True

    text = f"{type(exc).__name__} {exc}".lower()
    # Everything else — rate limits, 5xx, resets — is worth another attempt.
    return not any(marker in text for marker in _NON_RETRYABLE)


class ResilientLlmProvider(LlmProvider):
    """Wraps a provider with retries and a circuit breaker.

    Transparent: it implements the same interface, so nothing downstream knows
    it exists.
    """

    def __init__(
        self,
        inner: LlmProvider,
        *,
        max_attempts: int = 3,
        base_delay: float = 0.5,
        max_delay: float = 8.0,
        failure_threshold: int = 5,
        recovery_seconds: float = 30.0,
    ) -> None:
        self._inner = inner
        self._max_attempts = max(1, max_attempts)
        self._base_delay = base_delay
        self._max_delay = max_delay
        self._breaker = CircuitBreaker(
            failure_threshold=failure_threshold, recovery_seconds=recovery_seconds
        )

    @property
    def inner(self) -> LlmProvider:
        return self._inner

    def _backoff(self, attempt: int) -> float:
        """Exponential delay with full jitter, capped."""
        ceiling = min(self._max_delay, self._base_delay * (2**attempt))
        return random.uniform(0, ceiling)  # noqa: S311 - jitter, not cryptography

    async def _call(self, name: str, func, *args: Any, **kwargs: Any) -> Any:
        await self._breaker.before_call()

        last_exc: BaseException | None = None
        for attempt in range(self._max_attempts):
            try:
                result = await func(*args, **kwargs)
            except Exception as exc:  # noqa: BLE001 - classified below
                last_exc = exc
                if not is_retryable(exc):
                    # A permanent error is not evidence the provider is down,
                    # so it must not count toward opening the circuit.
                    log.warning("LLM %s failed permanently: %s", name, exc)
                    raise

                if attempt == self._max_attempts - 1:
                    break

                delay = self._backoff(attempt)
                log.warning(
                    "LLM %s failed (attempt %d/%d): %s — retrying in %.2fs",
                    name,
                    attempt + 1,
                    self._max_attempts,
                    exc,
                    delay,
                )
                await asyncio.sleep(delay)
            else:
                await self._breaker.record_success()
                return result

        await self._breaker.record_failure()
        raise LlmUnavailableError(
            f"The AI provider failed after {self._max_attempts} attempts."
        ) from last_exc

    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion:
        return await self._call(
            "generate", self._inner.generate, messages, model=model, temperature=temperature
        )

    async def extract(
        self, schema: dict[str, Any], text: str, *, instructions: str | None = None
    ) -> dict[str, Any]:
        return await self._call(
            "extract", self._inner.extract, schema, text, instructions=instructions
        )

    async def embed(self, text: str) -> list[float]:
        return await self._call("embed", self._inner.embed, text)
