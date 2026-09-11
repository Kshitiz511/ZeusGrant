"""Anthropic implementation of :class:`LlmProvider`."""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import LlmProvider
from zeus_adapters.llm.json_parsing import parse_json_object
from zeus_adapters.models import Completion, Extraction, Message, Role


class AnthropicProvider(LlmProvider):
    def __init__(self, *, api_key: str, model: str, timeout_seconds: int = 60) -> None:
        try:
            from anthropic import AsyncAnthropic
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Anthropic provider selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[anthropic]'`."
            ) from exc
        self._client = AsyncAnthropic(api_key=api_key, timeout=timeout_seconds)
        self._model = model

    @staticmethod
    def _split_system(messages: list[Message]) -> tuple[str | None, list[dict[str, str]]]:
        system = next((m.content for m in messages if m.role is Role.system), None)
        turns = [
            {"role": m.role.value, "content": m.content}
            for m in messages
            if m.role is not Role.system
        ]
        return system, turns

    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion:
        system, turns = self._split_system(messages)
        resp = await self._client.messages.create(
            model=model or self._model,
            system=system or "",
            messages=turns,
            temperature=temperature,
            max_tokens=4096,
        )
        text = "".join(block.text for block in resp.content if block.type == "text")
        return Completion(
            text=text,
            model=resp.model,
            prompt_tokens=resp.usage.input_tokens,
            completion_tokens=resp.usage.output_tokens,
        )

    async def extract(
        self, schema: dict[str, Any], text: str, *, instructions: str | None = None
    ) -> Extraction:
        system = (instructions or "Extract structured data.") + " Respond with JSON only."
        resp = await self._client.messages.create(
            model=self._model,
            system=system,
            messages=[
                {
                    "role": "user",
                    "content": f"JSON schema:\n{json.dumps(schema)}\n\nText:\n{text}",
                }
            ],
            temperature=0,
            max_tokens=4096,
        )
        raw = "".join(block.text for block in resp.content if block.type == "text")
        usage = getattr(resp, "usage", None)
        return Extraction(
            data=parse_json_object(raw or ""),
            model=getattr(resp, "model", self._model),
            # Anthropic names these differently from OpenAI; normalise here so
            # callers never branch on provider.
            prompt_tokens=getattr(usage, "input_tokens", None),
            completion_tokens=getattr(usage, "output_tokens", None),
        )

    async def embed(self, text: str) -> list[float]:
        raise NotImplementedError(
            "Anthropic has no embeddings API; use a dedicated embeddings provider."
        )
