"""QStash implementation of :class:`Queue` (HTTP-based, serverless-native)."""

from __future__ import annotations

import json
from typing import Any

import httpx

from zeus_adapters.interfaces import Queue


class QStashQueue(Queue):
    """Publishes messages to QStash, which delivers them over HTTP.

    ``topic`` maps to a destination URL registered in QStash config. For
    Phase 0 this stores the base URL and token; wiring destinations is a
    Phase 1 concern once worker endpoints exist.
    """

    def __init__(self, *, token: str, base_url: str) -> None:
        self._token = token
        self._base_url = base_url.rstrip("/")

    async def _post(self, topic: str, payload: dict[str, Any], headers: dict[str, str]) -> str:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._base_url}/v2/publish/{topic}",
                content=json.dumps(payload),
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Content-Type": "application/json",
                    **headers,
                },
            )
            resp.raise_for_status()
            return resp.json().get("messageId", "")

    async def publish(self, topic: str, payload: dict[str, Any]) -> str:
        return await self._post(topic, payload, headers={})

    async def schedule(
        self, topic: str, payload: dict[str, Any], *, delay_seconds: int
    ) -> str:
        return await self._post(topic, payload, headers={"Upstash-Delay": f"{delay_seconds}s"})
