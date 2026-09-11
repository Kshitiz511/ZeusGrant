"""Redis implementation of :class:`Cache` (works with Upstash over TLS)."""

from __future__ import annotations

from zeus_adapters.interfaces import Cache


class RedisCache(Cache):
    def __init__(self, *, url: str) -> None:
        try:
            from redis.asyncio import from_url
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Redis cache selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[redis]'`."
            ) from exc

        kwargs: dict[str, object] = {"decode_responses": True}
        if url.startswith("rediss://"):
            # Pin the CA bundle explicitly instead of trusting the host's
            # store. Upstash's certificate verifies against certifi, but a
            # slim container or a dev machine with no system roots would fail
            # at connect time — and a TLS error on first cache write is an
            # opaque way to discover that.
            import certifi

            kwargs["ssl_ca_certs"] = certifi.where()

        self._redis = from_url(url, **kwargs)

    async def get(self, key: str) -> str | None:
        return await self._redis.get(key)

    async def set(self, key: str, value: str, *, ttl_seconds: int | None = None) -> None:
        await self._redis.set(key, value, ex=ttl_seconds)

    async def delete(self, key: str) -> None:
        await self._redis.delete(key)

    async def invalidate(self, pattern: str) -> int:
        removed = 0
        async for key in self._redis.scan_iter(match=pattern):
            await self._redis.delete(key)
            removed += 1
        return removed
