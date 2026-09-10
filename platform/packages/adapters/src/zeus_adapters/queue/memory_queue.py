"""In-memory :class:`Queue` for local development and tests."""

from __future__ import annotations

import uuid
from typing import Any

from zeus_adapters.interfaces import Queue


class MemoryQueue(Queue):
    def __init__(self) -> None:
        self.published: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, topic: str, payload: dict[str, Any]) -> str:
        self.published.append((topic, payload))
        return uuid.uuid4().hex

    async def schedule(
        self, topic: str, payload: dict[str, Any], *, delay_seconds: int
    ) -> str:
        self.published.append((topic, {**payload, "_delay": delay_seconds}))
        return uuid.uuid4().hex
