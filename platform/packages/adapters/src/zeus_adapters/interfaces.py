"""Vendor-neutral adapter interfaces.

These abstract base classes are the anti-lock-in layer. Every external
dependency is consumed only through one of these interfaces, so swapping a
provider (OpenAI -> Anthropic, QStash -> RabbitMQ, Supabase -> Keycloak) is
a configuration change plus one implementation, never a rewrite.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from zeus_adapters.models import (
    CheckoutSession,
    Completion,
    EntitlementChange,
    Message,
    Session,
)


class LlmProvider(ABC):
    """Text generation, structured extraction and embeddings."""

    @abstractmethod
    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion: ...

    @abstractmethod
    async def extract(
        self, schema: dict[str, Any], text: str, *, instructions: str | None = None
    ) -> dict[str, Any]:
        """Return structured JSON matching ``schema`` extracted from ``text``."""

    @abstractmethod
    async def embed(self, text: str) -> list[float]: ...


class Cache(ABC):
    """Key/value cache (sessions, entitlements, hot config)."""

    @abstractmethod
    async def get(self, key: str) -> str | None: ...

    @abstractmethod
    async def set(self, key: str, value: str, *, ttl_seconds: int | None = None) -> None: ...

    @abstractmethod
    async def delete(self, key: str) -> None: ...

    @abstractmethod
    async def invalidate(self, pattern: str) -> int:
        """Delete all keys matching ``pattern``; return the count removed."""


class Database(ABC):
    """Async SQL access. Thin by design; domain logic stays out of adapters."""

    @abstractmethod
    async def connect(self) -> None:
        """Open the connection pool. Idempotent."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Close the connection pool."""

    @abstractmethod
    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        """Return all rows as dicts."""

    @abstractmethod
    async def fetch_one(self, query: str, *args: Any) -> dict[str, Any] | None:
        """Return the first row as a dict, or None."""

    @abstractmethod
    async def execute(self, query: str, *args: Any) -> str:
        """Run a statement; return the command status tag."""


class Queue(ABC):
    """Async message publishing for the eventing layer."""

    @abstractmethod
    async def publish(self, topic: str, payload: dict[str, Any]) -> str:
        """Publish and return a message id."""

    @abstractmethod
    async def schedule(
        self, topic: str, payload: dict[str, Any], *, delay_seconds: int
    ) -> str: ...


class AuthProvider(ABC):
    """Token verification and claim issuance."""

    @abstractmethod
    async def verify(self, token: str) -> Session: ...

    @abstractmethod
    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        """Return a signed JWT carrying tenant + entitlement context."""


class Storage(ABC):
    """Object storage for evidence and documents."""

    @abstractmethod
    async def put(self, bucket: str, key: str, data: bytes, *, content_type: str) -> str: ...

    @abstractmethod
    async def signed_url(self, bucket: str, key: str, *, ttl_seconds: int = 3600) -> str: ...

    @abstractmethod
    async def delete(self, bucket: str, key: str) -> None: ...


class BillingProvider(ABC):
    """Checkout and webhook normalization."""

    @abstractmethod
    async def create_checkout(
        self, *, tenant_id: str, price_id: str, return_url: str, trial_days: int | None = None
    ) -> CheckoutSession: ...

    @abstractmethod
    async def create_portal(self, *, customer_id: str, return_url: str) -> str: ...

    @abstractmethod
    def parse_webhook(self, payload: bytes, signature: str) -> EntitlementChange:
        """Verify signature and normalize the event into an EntitlementChange."""


__all__ = [
    "LlmProvider",
    "Cache",
    "Database",
    "Queue",
    "AuthProvider",
    "Storage",
    "BillingProvider",
]
