"""Google Gemini implementation of :class:`LlmProvider`."""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import LlmProvider
from zeus_adapters.models import Completion, Message, Role


class GeminiProvider(LlmProvider):
    def __init__(self, *, api_key: str, model: str, timeout_seconds: int = 60) -> None:
        try:
            from google import genai
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Gemini provider selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[gemini]'`."
            ) from exc
        self._client = genai.Client(api_key=api_key)
        self._model = model

    @staticmethod
    def _flatten(messages: list[Message]) -> tuple[str | None, str]:
        system = next((m.content for m in messages if m.role is Role.system), None)
        body = "\n\n".join(
            f"{m.role.value}: {m.content}" for m in messages if m.role is not Role.system
        )
        return system, body

    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion:
        system, body = self._flatten(messages)
        resp = await self._client.aio.models.generate_content(
            model=model or self._model,
            contents=body,
            config={"temperature": temperature, "system_instruction": system},
        )
        return Completion(text=resp.text or "", model=model or self._model)

    async def extract(
        self, schema: dict[str, Any], text: str, *, instructions: str | None = None
    ) -> dict[str, Any]:
        system = (instructions or "Extract structured data.") + " Respond with JSON only."
        resp = await self._client.aio.models.generate_content(
            model=self._model,
            contents=f"JSON schema:\n{json.dumps(schema)}\n\nText:\n{text}",
            config={
                "temperature": 0,
                "system_instruction": system,
                "response_mime_type": "application/json",
            },
        )
        return json.loads(resp.text or "{}")

    async def embed(self, text: str) -> list[float]:
        resp = await self._client.aio.models.embed_content(
            model="text-embedding-004", contents=text
        )
        return list(resp.embeddings[0].values)
