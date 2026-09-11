"""Filesystem implementation of :class:`Storage`.

Used for local development, CI and self-hosted deployments where no object
store is available. Semantics deliberately match the Supabase adapter so a
deployment can switch providers with one environment variable.

Security notes:
  * Bucket and key are sanitized and the resolved path is asserted to stay
    inside the configured root, so a crafted key (``../../etc/passwd``) cannot
    escape the sandbox.
  * ``signed_url`` returns an opaque ``local://`` URI rather than a public URL.
    Downloads always go through the service's own authenticated route, which
    reads bytes via :meth:`get`. Nothing is ever served directly off disk.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from zeus_adapters.interfaces import Storage


class LocalStorage(Storage):
    def __init__(self, *, root: str) -> None:
        self._root = Path(root).expanduser().resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, bucket: str, key: str) -> Path:
        if not bucket or "/" in bucket or bucket in {".", ".."}:
            raise ValueError(f"Invalid bucket: {bucket!r}")
        if not key:
            raise ValueError("Storage key must not be empty.")

        candidate = (self._root / bucket / key).resolve()
        base = (self._root / bucket).resolve()
        # `is_relative_to` is the traversal guard: any `..` in the key that
        # escapes the bucket directory fails here rather than touching disk.
        if not candidate.is_relative_to(base):
            raise ValueError(f"Storage key escapes its bucket: {key!r}")
        return candidate

    async def put(self, bucket: str, key: str, data: bytes, *, content_type: str) -> str:
        path = self._resolve(bucket, key)

        def _write() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write to a temp sibling then rename: readers never observe a
            # partially written object.
            tmp = path.with_suffix(path.suffix + ".part")
            tmp.write_bytes(data)
            tmp.replace(path)

        await asyncio.to_thread(_write)
        return key

    async def get(self, bucket: str, key: str) -> bytes:
        path = self._resolve(bucket, key)
        if not path.is_file():
            raise FileNotFoundError(f"Object not found: {bucket}/{key}")
        return await asyncio.to_thread(path.read_bytes)

    async def signed_url(self, bucket: str, key: str, *, ttl_seconds: int = 3600) -> str:
        return f"local://{bucket}/{key}"

    async def delete(self, bucket: str, key: str) -> None:
        path = self._resolve(bucket, key)

        def _unlink() -> None:
            path.unlink(missing_ok=True)

        await asyncio.to_thread(_unlink)
