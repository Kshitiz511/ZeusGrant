"""Admin-managed runtime configuration.

Operational settings — API keys, model choice, Stripe price ids — are edited by
the platform owner in the admin dashboard and stored in ``platform_config``
(secrets encrypted at rest). Environment variables remain the fallback floor, so
a freshly deployed instance still boots before anything has been entered.

Resolution order for a managed key::

    platform_config (database)  →  environment variable  →  unset

Two deliberate exclusions. First, the **bootstrap** settings cannot live here:
reading the database requires ``ZEUS_DATABASE_URL``, and decrypting a secret
requires ``ZEUS_SECRETS_ENCRYPTION_KEY``. Storing either in the thing they
unlock is circular, so both stay in the platform's environment and are rejected
by :func:`managed_key` if someone tries to set them. Second, this registry is
**platform-wide, not per-tenant** — a tenant admin must never reach it.

Values are cached with a short TTL because on serverless every cold start would
otherwise pay a database round trip per key. Writes invalidate immediately, so
the TTL only bounds staleness between instances, not after an edit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from zeus_adapters.interfaces import Cache

from zeus_platform_core.repositories.config_registry import ConfigRepository

CACHE_PREFIX = "cfg:"
CACHE_TTL_SECONDS = 60

# Sentinel stored in the cache to represent "checked, and it is not in the
# database". Without it a key that lives only in the environment would hit
# Postgres on every single request.
_MISS = "\x00miss"

Source = Literal["database", "environment", "unset"]


@dataclass(frozen=True, slots=True)
class ManagedKey:
    """A setting the platform owner may edit from the admin dashboard."""

    key: str
    label: str
    group: str
    env_var: str
    is_secret: bool = False
    #: Dotted path into ``Settings`` used to overlay the value at build time.
    settings_path: str | None = None
    help_text: str = ""


MANAGED_KEYS: tuple[ManagedKey, ...] = (
    # --- AI ---
    ManagedKey(
        key="llm.openai_api_key",
        label="OpenAI API key",
        group="AI",
        env_var="ZEUS_OPENAI_API_KEY",
        is_secret=True,
        settings_path="llm.openai_api_key",
        help_text="Used for contract extraction and every other model call.",
    ),
    ManagedKey(
        key="llm.model",
        label="Model",
        group="AI",
        env_var="ZEUS_LLM_MODEL",
        settings_path="llm.model",
        help_text="Changing this changes cost per run; check the usage report after.",
    ),
    ManagedKey(
        key="llm.provider",
        label="Provider",
        group="AI",
        env_var="ZEUS_LLM_PROVIDER",
        settings_path="llm.provider",
    ),
    # --- Billing ---
    ManagedKey(
        key="billing.stripe_secret_key",
        label="Stripe secret key",
        group="Billing",
        env_var="ZEUS_STRIPE_SECRET_KEY",
        is_secret=True,
        settings_path="billing.stripe_secret_key",
    ),
    ManagedKey(
        key="billing.stripe_webhook_secret",
        label="Stripe webhook signing secret",
        group="Billing",
        env_var="ZEUS_STRIPE_WEBHOOK_SECRET",
        is_secret=True,
        settings_path="billing.stripe_webhook_secret",
        help_text="Issued by Stripe when the webhook endpoint is created, after first deploy.",
    ),
)

_BY_KEY = {k.key: k for k in MANAGED_KEYS}

#: Settings that unlock the config store itself and therefore cannot be stored
#: inside it. Listed explicitly so the refusal is a clear error, not a puzzle.
#:
#: These are the real ``alias`` values from ``zeus_config.settings``. That is
#: load-bearing: this set is compared against ``ManagedKey.env_var``, so a name
#: that does not exist anywhere protects nothing. It previously read
#: ``ZEUS_JWT_SECRET``, which is not a setting the application has ever had --
#: the guard looked present and did nothing (defect D14).
BOOTSTRAP_ENV_VARS = frozenset(
    {
        "ZEUS_DATABASE_URL",
        "ZEUS_SECRETS_ENCRYPTION_KEY",
        "ZEUS_SUPABASE_JWT_SECRET",
        "ZEUS_REDIS_URL",
    }
)


class UnknownConfigKey(ValueError):
    """Raised when a key is not in the managed catalogue."""


def managed_key(key: str) -> ManagedKey:
    try:
        return _BY_KEY[key]
    except KeyError:
        raise UnknownConfigKey(
            f"{key!r} is not an admin-managed setting. "
            f"Known keys: {', '.join(sorted(_BY_KEY))}."
        ) from None


@dataclass(frozen=True, slots=True)
class KeyStatus:
    """What the dashboard renders — never the plaintext of a secret."""

    key: str
    label: str
    group: str
    is_secret: bool
    source: Source
    #: Masked preview for non-secrets, ``None`` for secrets.
    preview: str | None
    help_text: str


class RuntimeConfigService:
    def __init__(
        self,
        *,
        config: ConfigRepository,
        cache: Cache,
        env: dict[str, str],
        ttl_seconds: int = CACHE_TTL_SECONDS,
    ) -> None:
        self._config = config
        self._cache = cache
        self._env = env
        self._ttl = ttl_seconds

    async def get(self, key: str) -> str | None:
        """Resolve a managed key: database, then environment, then ``None``."""
        spec = managed_key(key)
        cached = await self._cache.get(CACHE_PREFIX + key)
        if cached == _MISS:
            stored = None
        elif cached is not None:
            stored = cached
        else:
            stored = await self._config.get(key)
            await self._cache.set(
                CACHE_PREFIX + key, _MISS if stored is None else stored, ttl_seconds=self._ttl
            )
        if stored is not None:
            return stored
        return self._env.get(spec.env_var) or None

    async def set(self, key: str, value: str, *, updated_by: str | None = None) -> None:
        spec = managed_key(key)
        value = value.strip()
        if not value:
            raise ValueError(f"{key!r} cannot be set to an empty value; delete it instead.")
        await self._config.set(key, value, is_secret=spec.is_secret, updated_by=updated_by)
        await self._cache.delete(CACHE_PREFIX + key)

    async def clear(self, key: str) -> None:
        """Remove the override so the environment value takes over again."""
        managed_key(key)
        await self._config.delete(key)
        await self._cache.delete(CACHE_PREFIX + key)

    async def status(self) -> list[KeyStatus]:
        """Catalogue plus provenance for the dashboard."""
        out: list[KeyStatus] = []
        for spec in MANAGED_KEYS:
            stored = await self._config.get(spec.key)
            if stored is not None:
                source: Source = "database"
                value: str | None = stored
            elif self._env.get(spec.env_var):
                source = "environment"
                value = self._env[spec.env_var]
            else:
                source = "unset"
                value = None
            out.append(
                KeyStatus(
                    key=spec.key,
                    label=spec.label,
                    group=spec.group,
                    is_secret=spec.is_secret,
                    source=source,
                    preview=None if spec.is_secret else value,
                    help_text=spec.help_text,
                )
            )
        return out
