"""Supabase Storage implementation of :class:`Storage`."""

from __future__ import annotations

from zeus_adapters.interfaces import Storage


class SupabaseStorage(Storage):
    def __init__(self, *, url: str, service_role_key: str) -> None:
        try:
            from supabase import create_client
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Supabase storage selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[supabase]'`."
            ) from exc
        self._client = create_client(url, service_role_key)

    async def put(self, bucket: str, key: str, data: bytes, *, content_type: str) -> str:
        self._client.storage.from_(bucket).upload(
            key, data, {"content-type": content_type, "upsert": "true"}
        )
        return key

    async def signed_url(self, bucket: str, key: str, *, ttl_seconds: int = 3600) -> str:
        res = self._client.storage.from_(bucket).create_signed_url(key, ttl_seconds)
        return res["signedURL"]

    async def delete(self, bucket: str, key: str) -> None:
        self._client.storage.from_(bucket).remove([key])
