"""Tests for adapter factories: provider selection is config-driven and
missing configuration fails loudly (no silent hardcoded fallbacks)."""

import pytest
from zeus_adapters import build_cache, build_llm_provider, build_queue
from zeus_config import get_settings


@pytest.fixture(autouse=True)
def _reset_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_memory_cache_selected(monkeypatch):
    monkeypatch.setenv("ZEUS_CACHE_PROVIDER", "memory")
    get_settings.cache_clear()
    cache = build_cache(get_settings())
    assert cache.__class__.__name__ == "MemoryCache"


def test_memory_queue_selected(monkeypatch):
    monkeypatch.setenv("ZEUS_QUEUE_PROVIDER", "memory")
    get_settings.cache_clear()
    queue = build_queue(get_settings())
    assert queue.__class__.__name__ == "MemoryQueue"


def test_llm_requires_key(monkeypatch):
    monkeypatch.setenv("ZEUS_LLM_PROVIDER", "openai")
    # Override rather than delete: a real key may exist in platform/.env, and
    # process env takes precedence. Empty string == missing to the factory.
    monkeypatch.setenv("ZEUS_OPENAI_API_KEY", "")
    get_settings.cache_clear()
    with pytest.raises(ValueError, match="ZEUS_OPENAI_API_KEY"):
        build_llm_provider(get_settings())


def test_unknown_provider_rejected(monkeypatch):
    monkeypatch.setenv("ZEUS_CACHE_PROVIDER", "bogus")
    get_settings.cache_clear()
    with pytest.raises(ValueError, match="Unknown cache provider"):
        build_cache(get_settings())
