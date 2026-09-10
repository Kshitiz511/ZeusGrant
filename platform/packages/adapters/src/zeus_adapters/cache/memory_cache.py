"""In-memory :class:`Cache` for local development and tests.

Avoids requiring a live Redis during Phase 0 bootstrap. Not for production.
"""

from __future__ import annotations

import fnmatch
import time

from zeus_adapters.interfaces import Cache


class MemoryCache(Cache):
    def __init__(self) -> None:
        self._store: dict[str, tuple[str, float | None]] = {}

    def _expired(self, key: str) -> bool:
        item = self._store.get(key)
        if item is None:
            return True
        _, expires = item
        if expires is not None and expires < time.monotonic():
            del self._store[key]
            return True
        return False

    async def get(self, key: str) -> str | None:
        if self._expired(key):
            return None
        return self._store[key][0]

    async def set(self, key: str, value: str, *, ttl_seconds: int | None = None) -> None:
        expires = time.monotonic() + ttl_seconds if ttl_seconds else None
        self._store[key] = (value, expires)

    async def delete(self, key: str) -> None:
        self._store.pop(key, None)

    async def invalidate(self, pattern: str) -> int:
        keys = [k for k in self._store if fnmatch.fnmatch(k, pattern)]
        for k in keys:
            del self._store[k]
        return len(keys)
