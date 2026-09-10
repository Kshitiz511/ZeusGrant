"""Factory that selects an :class:`LlmProvider` from settings.

Provider and key selection is fully config-driven. This is the single seam
that replaces the hardcoded Lovable AI gateway used by the legacy app.
"""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import LlmProvider


def _key(secret) -> str | None:
    return secret.get_secret_value() if secret is not None else None


def build_llm_provider(settings: Settings) -> LlmProvider:
    llm = settings.llm
    provider = llm.provider.lower()

    if provider == "openai":
        key = _key(llm.openai_api_key)
        if not key:
            raise ValueError("ZEUS_OPENAI_API_KEY is required for the openai provider.")
        from zeus_adapters.llm.openai_provider import OpenAiProvider

        return OpenAiProvider(api_key=key, model=llm.model, timeout_seconds=llm.timeout_seconds)

    if provider == "anthropic":
        key = _key(llm.anthropic_api_key)
        if not key:
            raise ValueError("ZEUS_ANTHROPIC_API_KEY is required for the anthropic provider.")
        from zeus_adapters.llm.anthropic_provider import AnthropicProvider

        return AnthropicProvider(api_key=key, model=llm.model, timeout_seconds=llm.timeout_seconds)

    if provider == "gemini":
        key = _key(llm.gemini_api_key)
        if not key:
            raise ValueError("ZEUS_GEMINI_API_KEY is required for the gemini provider.")
        from zeus_adapters.llm.gemini_provider import GeminiProvider

        return GeminiProvider(api_key=key, model=llm.model, timeout_seconds=llm.timeout_seconds)

    if provider == "ollama":
        from zeus_adapters.llm.ollama_provider import OllamaProvider

        return OllamaProvider(
            base_url=llm.ollama_base_url,
            model=llm.model,
            timeout_seconds=llm.timeout_seconds,
        )

    raise ValueError(
        f"Unknown LLM provider: {provider!r}. "
        "Expected openai | anthropic | gemini | ollama."
    )
