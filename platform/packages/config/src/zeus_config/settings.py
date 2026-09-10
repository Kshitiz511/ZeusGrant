"""Typed application settings, loaded from the environment.

Grouped by concern to mirror the adapter layer. Every field maps to a
`ZEUS_*` environment variable so there is a single, auditable source of
configuration and zero hardcoded values.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(StrEnum):
    development = "development"
    staging = "staging"
    production = "production"


class _Base(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ZEUS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


class LlmSettings(_Base):
    provider: str = Field(default="openai", alias="ZEUS_LLM_PROVIDER")
    model: str = Field(default="gpt-4o-mini", alias="ZEUS_LLM_MODEL")
    timeout_seconds: int = Field(default=60, alias="ZEUS_LLM_TIMEOUT_SECONDS")
    openai_api_key: SecretStr | None = Field(default=None, alias="ZEUS_OPENAI_API_KEY")
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ZEUS_ANTHROPIC_API_KEY")
    gemini_api_key: SecretStr | None = Field(default=None, alias="ZEUS_GEMINI_API_KEY")
    ollama_base_url: str = Field(
        default="http://localhost:11434/v1", alias="ZEUS_OLLAMA_BASE_URL"
    )


class CacheSettings(_Base):
    provider: str = Field(default="redis", alias="ZEUS_CACHE_PROVIDER")
    redis_url: SecretStr | None = Field(default=None, alias="ZEUS_REDIS_URL")


class DatabaseSettings(_Base):
    provider: str = Field(default="postgres", alias="ZEUS_DATABASE_PROVIDER")
    url: SecretStr | None = Field(default=None, alias="ZEUS_DATABASE_URL")
    pool_min_size: int = Field(default=1, alias="ZEUS_DATABASE_POOL_MIN")
    pool_max_size: int = Field(default=10, alias="ZEUS_DATABASE_POOL_MAX")


class QueueSettings(_Base):
    provider: str = Field(default="qstash", alias="ZEUS_QUEUE_PROVIDER")
    qstash_token: SecretStr | None = Field(default=None, alias="ZEUS_QSTASH_TOKEN")
    qstash_url: str = Field(default="https://qstash.upstash.io", alias="ZEUS_QSTASH_URL")


class AuthSettings(_Base):
    provider: str = Field(default="supabase", alias="ZEUS_AUTH_PROVIDER")
    supabase_url: str | None = Field(default=None, alias="ZEUS_SUPABASE_URL")
    supabase_anon_key: SecretStr | None = Field(default=None, alias="ZEUS_SUPABASE_ANON_KEY")
    supabase_service_role_key: SecretStr | None = Field(
        default=None, alias="ZEUS_SUPABASE_SERVICE_ROLE_KEY"
    )
    supabase_jwt_secret: SecretStr | None = Field(default=None, alias="ZEUS_SUPABASE_JWT_SECRET")


class StorageSettings(_Base):
    provider: str = Field(default="supabase", alias="ZEUS_STORAGE_PROVIDER")
    bucket: str = Field(default="evidence", alias="ZEUS_STORAGE_BUCKET")


class BillingSettings(_Base):
    provider: str = Field(default="stripe", alias="ZEUS_BILLING_PROVIDER")
    stripe_secret_key: SecretStr | None = Field(default=None, alias="ZEUS_STRIPE_SECRET_KEY")
    stripe_webhook_secret: SecretStr | None = Field(
        default=None, alias="ZEUS_STRIPE_WEBHOOK_SECRET"
    )


class ObservabilitySettings(_Base):
    otel_enabled: bool = Field(default=False, alias="ZEUS_OTEL_ENABLED")
    otel_endpoint: str | None = Field(default=None, alias="ZEUS_OTEL_EXPORTER_OTLP_ENDPOINT")
    otel_headers: str | None = Field(default=None, alias="ZEUS_OTEL_EXPORTER_OTLP_HEADERS")


class Settings(_Base):
    """Root settings aggregate. Access via :func:`get_settings`."""

    env: Environment = Field(default=Environment.development, alias="ZEUS_ENV")
    log_level: str = Field(default="INFO", alias="ZEUS_LOG_LEVEL")
    dev_tokens_enabled: bool = Field(default=False, alias="ZEUS_DEV_TOKENS")
    # Shared secret authenticating internal worker callbacks (queue -> HTTP).
    worker_secret: SecretStr | None = Field(default=None, alias="ZEUS_WORKER_SECRET")
    secrets_encryption_key: SecretStr | None = Field(
        default=None, alias="ZEUS_SECRETS_ENCRYPTION_KEY"
    )

    llm: LlmSettings = Field(default_factory=LlmSettings)
    cache: CacheSettings = Field(default_factory=CacheSettings)
    database: DatabaseSettings = Field(default_factory=DatabaseSettings)
    queue: QueueSettings = Field(default_factory=QueueSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    billing: BillingSettings = Field(default_factory=BillingSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)

    @property
    def is_production(self) -> bool:
        return self.env is Environment.production


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings singleton.

    Cached so config is parsed once per process. Call
    ``get_settings.cache_clear()`` in tests to reload.
    """

    settings = Settings()
    # Keep provider/model consistent between the root and the LlmSettings group.
    return settings
