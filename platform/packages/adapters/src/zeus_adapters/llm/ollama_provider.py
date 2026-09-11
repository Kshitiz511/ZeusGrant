"""Ollama implementation of :class:`LlmProvider`.

Ollama exposes an OpenAI-compatible API, so this reuses the ``openai`` client
pointed at a local (or remote) Ollama server. No API key is required; a
placeholder is sent to satisfy the SDK.
"""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import LlmProvider
from zeus_adapters.llm.json_parsing import parse_json_object
from zeus_adapters.models import Completion, Message


class OllamaProvider(LlmProvider):
    def __init__(
        self,
        *,
        base_url: str = "http://localhost:11434/v1",
        model: str,
        timeout_seconds: int = 60,
        embed_model: str = "nomic-embed-text",
    ) -> None:
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Ollama provider uses the OpenAI client, which is not installed. "
                "Install with `uv pip install 'zeus-adapters[openai]'`."
            ) from exc
        # Ollama ignores the key but the SDK requires a non-empty value.
        self._client = AsyncOpenAI(
            api_key="ollama", base_url=base_url, timeout=timeout_seconds
        )
        self._model = model
        self._embed_model = embed_model

    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion:
        resp = await self._client.chat.completions.create(
            model=model or self._model,
            messages=[{"role": m.role.value, "content": m.content} for m in messages],
            temperature=temperature,
        )
        choice = resp.choices[0].message.content or ""
        usage = resp.usage
        return Completion(
            text=choice,
            model=resp.model,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
        )

    async def extract(
        self, schema: dict[str, Any], text: str, *, instructions: str | None = None
    ) -> dict[str, Any]:
        system = instructions or "Extract structured data. Respond with JSON only."
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"JSON schema:\n{json.dumps(schema)}\n\nText:\n{text}",
                },
            ],
            temperature=0,
            response_format={"type": "json_object"},
        )
        return parse_json_object(resp.choices[0].message.content or "")

    async def embed(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(model=self._embed_model, input=text)
        return resp.data[0].embedding
