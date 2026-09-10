"""Factory selecting a :class:`Cache` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import Cache


def build_cache(settings: Settings) -> Cache:
    provider = settings.cache.provider.lower()

    if provider == "memory":
        from zeus_adapters.cache.memory_cache import MemoryCache

        return MemoryCache()

    if provider == "redis":
        url = settings.cache.redis_url
        if not url:
            raise ValueError("ZEUS_REDIS_URL is required for the redis cache provider.")
        from zeus_adapters.cache.redis_cache import RedisCache

        return RedisCache(url=url.get_secret_value())

    raise ValueError(f"Unknown cache provider: {provider!r}. Expected memory | redis.")
