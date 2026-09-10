"""Factory selecting a :class:`Database` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import Database


def build_database(settings: Settings) -> Database:
    provider = settings.database.provider.lower()

    if provider == "postgres":
        url = settings.database.url
        if not url:
            raise ValueError("ZEUS_DATABASE_URL is required for the postgres database provider.")
        from zeus_adapters.db.postgres_db import PostgresDatabase

        return PostgresDatabase(
            dsn=url.get_secret_value(),
            min_size=settings.database.pool_min_size,
            max_size=settings.database.pool_max_size,
        )

    if provider == "fake":
        from zeus_adapters.db.fake_db import FakeDatabase

        return FakeDatabase()

    raise ValueError(f"Unknown database provider: {provider!r}. Expected postgres | fake.")
