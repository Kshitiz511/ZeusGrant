"""OpenAI implementation of :class:`LlmProvider`.

The ``openai`` package is an optional extra. Import failures surface a clear
message instructing which extra to install, keeping services lightweight.
"""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import LlmProvider
from zeus_adapters.llm.json_parsing import parse_json_object
from zeus_adapters.models import Completion, Extraction, Message


class OpenAiProvider(LlmProvider):
    def __init__(self, *, api_key: str, model: str, timeout_seconds: int = 60) -> None:
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "OpenAI provider selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[openai]'`."
            ) from exc
        self._client = AsyncOpenAI(api_key=api_key, timeout=timeout_seconds)
        self._model = model

    @staticmethod
    def _is_reasoning_model(model: str) -> bool:
        # GPT-5 / o-series only accept the default temperature (1) and support
        # reasoning_effort; classic models accept a custom temperature.
        return model.startswith(("gpt-5", "o1", "o3", "o4"))

    async def generate(
        self, messages: list[Message], *, model: str | None = None, temperature: float = 0.2
    ) -> Completion:
        chosen = model or self._model
        kwargs: dict[str, Any] = {}
        if not self._is_reasoning_model(chosen):
            kwargs["temperature"] = temperature
        resp = await self._client.chat.completions.create(
            model=chosen,
            messages=[{"role": m.role.value, "content": m.content} for m in messages],
            **kwargs,
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
    ) -> Extraction:
        system = instructions or "Extract structured data. Respond with JSON only."
        kwargs: dict[str, Any] = {}
        if self._is_reasoning_model(self._model):
            # Deterministic-ish extraction without burning tokens on reasoning.
            kwargs["reasoning_effort"] = "minimal"
        else:
            kwargs["temperature"] = 0
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"JSON schema:\n{json.dumps(schema)}\n\nText:\n{text}",
                },
            ],
            response_format={"type": "json_object"},
            **kwargs,
        )
        usage = resp.usage
        return Extraction(
            data=parse_json_object(resp.choices[0].message.content or ""),
            model=resp.model,
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
        )

    async def embed(self, text: str) -> list[float]:
        resp = await self._client.embeddings.create(
            model="text-embedding-3-small", input=text
        )
        return resp.data[0].embedding
