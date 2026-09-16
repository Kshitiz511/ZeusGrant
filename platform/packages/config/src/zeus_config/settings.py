"""Typed application settings, loaded from the environment.

Grouped by concern to mirror the adapter layer. Every field maps to a
`ZEUS_*` environment variable so there is a single, auditable source of
configuration and zero hardcoded values.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, SecretStr, model_validator
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
    # gpt-5-mini is the only model we are priced and tested against. The owner
    # can change it from the admin dashboard, but the default should never be a
    # model whose cost we have not measured.
    model: str = Field(default="gpt-5-mini", alias="ZEUS_LLM_MODEL")
    timeout_seconds: int = Field(default=60, alias="ZEUS_LLM_TIMEOUT_SECONDS")
    openai_api_key: SecretStr | None = Field(default=None, alias="ZEUS_OPENAI_API_KEY")
    anthropic_api_key: SecretStr | None = Field(default=None, alias="ZEUS_ANTHROPIC_API_KEY")
    gemini_api_key: SecretStr | None = Field(default=None, alias="ZEUS_GEMINI_API_KEY")
    ollama_base_url: str = Field(
        default="http://localhost:11434/v1", alias="ZEUS_OLLAMA_BASE_URL"
    )

    # Resilience. Defaults are tuned for interactive requests: three attempts
    # inside a 60s timeout budget, then fail rather than keep the user waiting.
    max_attempts: int = Field(default=3, alias="ZEUS_LLM_MAX_ATTEMPTS")
    retry_base_delay: float = Field(default=0.5, alias="ZEUS_LLM_RETRY_BASE_DELAY")
    retry_max_delay: float = Field(default=8.0, alias="ZEUS_LLM_RETRY_MAX_DELAY")
    breaker_failure_threshold: int = Field(
        default=5, alias="ZEUS_LLM_BREAKER_FAILURE_THRESHOLD"
    )
    breaker_recovery_seconds: float = Field(
        default=30.0, alias="ZEUS_LLM_BREAKER_RECOVERY_SECONDS"
    )

    # Chunking. Contracts routinely exceed a single context window once we
    # accept uploaded PDFs, so long bodies are split before extraction.
    # ~4 chars/token keeps a 24k-char chunk near 6k tokens of input.
    chunk_chars: int = Field(default=24_000, alias="ZEUS_LLM_CHUNK_CHARS")
    chunk_overlap_chars: int = Field(default=1_500, alias="ZEUS_LLM_CHUNK_OVERLAP_CHARS")
    max_chunks: int = Field(default=24, alias="ZEUS_LLM_MAX_CHUNKS")


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

    # --- Google Sign-In ------------------------------------------------------
    # All three must be present for the button to appear. Half-configured OAuth
    # fails at the redirect with an opaque Google error page, so the console
    # asks the server whether it is configured rather than guessing.
    google_client_id: str | None = Field(default=None, alias="ZEUS_GOOGLE_CLIENT_ID")
    google_client_secret: SecretStr | None = Field(
        default=None, alias="ZEUS_GOOGLE_CLIENT_SECRET"
    )
    #: Must match a redirect URI registered in the Google Cloud console exactly.
    google_redirect_uri: str | None = Field(default=None, alias="ZEUS_GOOGLE_REDIRECT_URI")

    @property
    def google_configured(self) -> bool:
        return bool(
            self.google_client_id and self.google_client_secret and self.google_redirect_uri
        )


class SessionSettings(_Base):
    """Refresh-token cookie policy.

    The short-lived access JWT stays in browser memory; durability across a
    reload comes from an opaque refresh token in an httpOnly cookie, which
    script can never read. ``cookie_secure`` is forced on in production by
    :meth:`Settings._harden_session_cookies`.
    """

    cookie_name: str = Field(default="zeus_session", alias="ZEUS_SESSION_COOKIE_NAME")
    # Readable-by-script companion used for the double-submit CSRF check. It
    # deliberately is *not* httpOnly: the whole point is that same-origin JS can
    # echo it back in a header that a cross-site form post cannot forge.
    csrf_cookie_name: str = Field(default="zeus_csrf", alias="ZEUS_SESSION_CSRF_COOKIE_NAME")
    cookie_path: str = Field(default="/", alias="ZEUS_SESSION_COOKIE_PATH")
    cookie_domain: str | None = Field(default=None, alias="ZEUS_SESSION_COOKIE_DOMAIN")
    cookie_secure: bool = Field(default=False, alias="ZEUS_SESSION_COOKIE_SECURE")
    # "lax" lets the cookie ride top-level navigations back from Stripe Checkout
    # while still blocking cross-site POSTs; "strict" breaks those returns.
    cookie_samesite: str = Field(default="lax", alias="ZEUS_SESSION_COOKIE_SAMESITE")
    # Absolute lifetime of a session family. Rotation issues a new token on
    # every refresh but never extends this deadline, so a stolen family still
    # dies on schedule.
    ttl_days: int = Field(default=14, alias="ZEUS_SESSION_TTL_DAYS")
    # Grace window in which re-presenting an already-rotated token is treated
    # as a benign race rather than theft. Two tabs restoring their session at
    # once, a retried request, or a double-click all land here; genuine replay
    # attacks essentially never arrive within seconds of the real client's own
    # refresh. Set to 0 to make detection absolute at the cost of spurious
    # logouts.
    reuse_leeway_seconds: int = Field(default=15, alias="ZEUS_SESSION_REUSE_LEEWAY_SECONDS")

    @property
    def ttl_seconds(self) -> int:
        return self.ttl_days * 24 * 60 * 60


class StorageSettings(_Base):
    provider: str = Field(default="supabase", alias="ZEUS_STORAGE_PROVIDER")
    bucket: str = Field(default="evidence", alias="ZEUS_STORAGE_BUCKET")
    # Root directory for the `local` provider (dev, CI, self-hosted).
    local_path: str = Field(default="./.zeus-storage", alias="ZEUS_STORAGE_LOCAL_PATH")
    # Hard ceiling on a single uploaded document, enforced before any parsing.
    max_upload_mb: int = Field(default=25, alias="ZEUS_STORAGE_MAX_UPLOAD_MB")

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


class BillingSettings(_Base):
    provider: str = Field(default="stripe", alias="ZEUS_BILLING_PROVIDER")
    stripe_secret_key: SecretStr | None = Field(default=None, alias="ZEUS_STRIPE_SECRET_KEY")
    stripe_webhook_secret: SecretStr | None = Field(
        default=None, alias="ZEUS_STRIPE_WEBHOOK_SECRET"
    )


class EmailSettings(_Base):
    # console = log only (dev); resend = real delivery.
    provider: str = Field(default="console", alias="ZEUS_EMAIL_PROVIDER")
    resend_api_key: SecretStr | None = Field(default=None, alias="ZEUS_RESEND_API_KEY")
    # Must be on a domain verified with the provider, or every send is rejected.
    from_address: str = Field(
        default="Zeus <onboarding@resend.dev>", alias="ZEUS_EMAIL_FROM"
    )
    # How long a verification code stays valid.
    verification_ttl_minutes: int = Field(
        default=15, alias="ZEUS_EMAIL_VERIFICATION_TTL_MINUTES"
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
    # Public origin of the console, used to build links that arrive in email
    # (invitations today). It cannot be derived from the request: a link built
    # from a Host header is a link an attacker can point wherever they like,
    # which turns an invitation into a credential-harvesting page.
    app_base_url: str = Field(default="http://localhost:5173", alias="ZEUS_APP_BASE_URL")
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
    session: SessionSettings = Field(default_factory=SessionSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    billing: BillingSettings = Field(default_factory=BillingSettings)
    email: EmailSettings = Field(default_factory=EmailSettings)
    observability: ObservabilitySettings = Field(default_factory=ObservabilitySettings)

    @property
    def is_production(self) -> bool:
        return self.env is Environment.production

    @model_validator(mode="after")
    def _forbid_dev_tokens_in_production(self) -> Settings:
        """Refuse to start a production process with dev tokens enabled.

        ``/dev/token`` mints a tenant-scoped JWT for any tenant id with no
        password, so leaving it on in production is a full authentication
        bypass. Silently disabling it would hide the mistake, so this fails
        fast instead: the service will not boot with an unsafe configuration.
        """
        if self.is_production and self.dev_tokens_enabled:
            raise ValueError(
                "ZEUS_DEV_TOKENS must not be enabled when ZEUS_ENV=production. "
                "The /dev/token endpoint mints tokens for any tenant without a "
                "password and would be a complete authentication bypass."
            )
        return self

    @model_validator(mode="after")
    def _harden_session_cookies(self) -> Settings:
        """Force ``Secure`` on the session cookie in production.

        Overriding rather than erroring is the right call here because the only
        reason the flag is off by default is local HTTP development. Turning it
        on cannot break a correctly-deployed production site (which is HTTPS),
        whereas leaving it off would let the refresh token leak over plaintext.
        """
        if self.is_production and not self.session.cookie_secure:
            self.session.cookie_secure = True
        return self

    @model_validator(mode="after")
    def _require_production_secrets(self) -> Settings:
        """Fail fast when production is missing a secret it cannot work without.

        Each of these degrades security silently rather than visibly: a default
        JWT secret means forgeable tokens, and a missing encryption key means
        tenant secrets are stored unprotected.
        """
        if not self.is_production:
            return self

        missing = []
        secret = self.auth.supabase_jwt_secret
        if not secret or not secret.get_secret_value():
            missing.append("ZEUS_SUPABASE_JWT_SECRET")
        if not self.secrets_encryption_key or not self.secrets_encryption_key.get_secret_value():
            missing.append("ZEUS_SECRETS_ENCRYPTION_KEY")
        if missing:
            raise ValueError(
                "Missing required production configuration: " + ", ".join(missing)
            )
        return self

    @model_validator(mode="after")
    def _forbid_console_email_in_production(self) -> Settings:
        """Refuse to start production with the logging-only email transport.

        The console sender discards the message. In production that means every
        verification code is silently dropped, and because sign-in is gated on
        verification, no new user could ever reach their account. The failure
        would look like a broken signup form rather than a misconfiguration.
        """
        if self.is_production and self.email.provider.lower() == "console":
            raise ValueError(
                "ZEUS_EMAIL_PROVIDER must not be 'console' when ZEUS_ENV=production. "
                "The console transport only logs messages, so verification codes "
                "would never be delivered and no new user could sign in."
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the cached settings singleton.

    Cached so config is parsed once per process. Call
    ``get_settings.cache_clear()`` in tests to reload.
    """

    settings = Settings()
    # Keep provider/model consistent between the root and the LlmSettings group.
    return settings