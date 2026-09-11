"""Admin-managed config and the versioned prompt registry.

Secret config values are encrypted with :class:`SecretBox` before they touch
the database, so Postgres only ever holds ciphertext (``zsb1:...``).
"""

from __future__ import annotations

from zeus_adapters.interfaces import Database
from zeus_config import SecretBox


class ConfigRepository:
    def __init__(self, db: Database, secret_box: SecretBox | None = None) -> None:
        self._db = db
        self._box = secret_box

    async def get(self, key: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT value, is_secret FROM platform.platform_config WHERE key = $1", key
        )
        if row is None:
            return None
        value = row["value"]
        if row["is_secret"] and value is not None:
            if self._box is None:
                raise RuntimeError(
                    f"Config key {key!r} is secret but no SecretBox is configured "
                    "(set ZEUS_SECRETS_ENCRYPTION_KEY)."
                )
            return self._box.decrypt(value)
        return value

    async def set(
        self, key: str, value: str, *, is_secret: bool = False, updated_by: str | None = None
    ) -> None:
        stored = value
        if is_secret:
            if self._box is None:
                raise RuntimeError(
                    "Cannot store a secret without a SecretBox "
                    "(set ZEUS_SECRETS_ENCRYPTION_KEY)."
                )
            stored = self._box.encrypt(value)
        await self._db.execute(
            """
            INSERT INTO platform.platform_config (key, value, is_secret, updated_by, updated_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value,
                  is_secret = EXCLUDED.is_secret,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = now()
            """,
            key,
            stored,
            is_secret,
            updated_by,
        )

    async def delete(self, key: str) -> None:
        await self._db.execute("DELETE FROM platform.platform_config WHERE key = $1", key)


class PromptRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def active_body(self, name: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT body FROM platform.prompt_registry WHERE name = $1 AND is_active LIMIT 1",
            name,
        )
        return row["body"] if row else None

    async def add_version(self, *, name: str, body: str, created_by: str | None = None) -> int:
        row = await self._db.fetch_one(
            "SELECT COALESCE(MAX(version), 0) + 1 AS next "
            "FROM platform.prompt_registry WHERE name = $1",
            name,
        )
        version = row["next"] if row else 1
        await self._db.execute(
            """
            INSERT INTO platform.prompt_registry (name, version, body, created_by)
            VALUES ($1, $2, $3, $4)
            """,
            name,
            version,
            body,
            created_by,
        )
        return version

    async def activate(self, *, name: str, version: int) -> None:
        # Only one active version per prompt name.
        await self._db.execute(
            "UPDATE platform.prompt_registry SET is_active = false WHERE name = $1", name
        )
        await self._db.execute(
            "UPDATE platform.prompt_registry SET is_active = true WHERE name = $1 AND version = $2",
            name,
            version,
        )
