"""Tests for the filesystem Storage adapter.

The traversal guard is the security-critical part: storage keys are derived
server-side today, but the adapter must be safe even if a future caller passes
something hostile.
"""

from __future__ import annotations

import pytest
from zeus_adapters.storage.local_storage import LocalStorage


@pytest.fixture
def storage(tmp_path) -> LocalStorage:
    return LocalStorage(root=str(tmp_path / "objects"))


@pytest.mark.asyncio
async def test_put_then_get_roundtrips(storage: LocalStorage):
    await storage.put("evidence", "t1/c1/file.pdf", b"hello", content_type="application/pdf")
    assert await storage.get("evidence", "t1/c1/file.pdf") == b"hello"


@pytest.mark.asyncio
async def test_put_overwrites_atomically(storage: LocalStorage):
    await storage.put("evidence", "k", b"v1", content_type="text/plain")
    await storage.put("evidence", "k", b"v2", content_type="text/plain")
    assert await storage.get("evidence", "k") == b"v2"


@pytest.mark.asyncio
async def test_missing_object_raises_file_not_found(storage: LocalStorage):
    with pytest.raises(FileNotFoundError):
        await storage.get("evidence", "nope")


@pytest.mark.asyncio
async def test_delete_is_idempotent(storage: LocalStorage):
    await storage.put("evidence", "k", b"v", content_type="text/plain")
    await storage.delete("evidence", "k")
    await storage.delete("evidence", "k")  # no error on the second call
    with pytest.raises(FileNotFoundError):
        await storage.get("evidence", "k")


@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["../escape", "a/../../escape", "../../../etc/passwd"])
async def test_path_traversal_is_refused(storage: LocalStorage, key: str):
    with pytest.raises(ValueError, match="escapes its bucket"):
        await storage.put("evidence", key, b"x", content_type="text/plain")


@pytest.mark.asyncio
@pytest.mark.parametrize("bucket", ["", "..", "a/b"])
async def test_invalid_bucket_is_refused(storage: LocalStorage, bucket: str):
    with pytest.raises(ValueError, match="Invalid bucket"):
        await storage.put(bucket, "k", b"x", content_type="text/plain")


@pytest.mark.asyncio
async def test_signed_url_is_opaque_not_a_filesystem_path(storage: LocalStorage, tmp_path):
    url = await storage.signed_url("evidence", "t1/c1/file.pdf")
    # Never leak the on-disk location; downloads go through the service.
    assert url == "local://evidence/t1/c1/file.pdf"
    assert str(tmp_path) not in url
