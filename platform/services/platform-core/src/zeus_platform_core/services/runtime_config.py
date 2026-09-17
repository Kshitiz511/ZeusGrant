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

**This cache's own TTL is deliberately not a managed key.** Resolving it would
mean reading the config store, which is the thing the TTL governs -- the same
circularity that keeps ``ZEUS_DATABASE_URL`` out of the registry. It stays a
constant. Every *other* cache lifetime is managed and bounded; see the
``Caching`` group below.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

from zeus_adapters.interfaces import Cache

from zeus_platform_core.repositories.config_registry import ConfigRepository

log = logging.getLogger(__name__)

CACHE_PREFIX = "cfg:"
CACHE_TTL_SECONDS = 60

#: What a stored string is text *of*. Everything in the config store is text;
#: this is what lets a numeric key carry a bound.
ValueType = Literal["string", "int", "float", "bool"]

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
    #: How the stored string is interpreted. Everything in the config store is
    #: text; this says what it is text *of*, so a bound can be checked.
    value_type: ValueType = "string"
    #: Inclusive bounds for numeric keys. ``None`` means unbounded in that
    #: direction, which is only appropriate where a silly value is merely
    #: wasteful rather than dangerous.
    minimum: float | None = None
    maximum: float | None = None

    def coerce(self, raw: str) -> str | int | float | bool:
        """Parse a stored string into its declared type. Raises ``ValueError``."""
        text = raw.strip()
        if self.value_type == "int":
            return int(text)
        if self.value_type == "float":
            return float(text)
        if self.value_type == "bool":
            if text.lower() in {"1", "true", "yes", "on"}:
                return True
            if text.lower() in {"0", "false", "no", "off"}:
                return False
            raise ValueError(f"{text!r} is not a boolean")
        return text

    def validate(self, raw: str) -> None:
        """Reject a value the platform must not be run with.

        Bounds are the whole point of this method, and they are not a
        convenience. Several of these keys are cache lifetimes for
        authorisation decisions: an admin who types 86400 into the membership
        TTL has granted everyone who was removed from a workspace another day
        of access, and nothing anywhere else would notice. A typo in a text box
        must not be able to do that, so the range is enforced rather than
        documented.

        The error names the accepted range instead of just refusing, because
        an operator who is told "invalid" will try again with another guess.
        """
        try:
            value = self.coerce(raw)
        except ValueError as exc:
            raise ValueError(f"{self.key!r} expects {self.value_type}: {exc}") from None

        if isinstance(value, bool) or not isinstance(value, int | float):
            return
        if self.minimum is not None and value < self.minimum:
            raise ValueError(
                f"{self.key!r} must be at least {_fmt(self.minimum)} "
                f"(got {_fmt(value)}). {self.help_text}".strip()
            )
        if self.maximum is not None and value > self.maximum:
            raise ValueError(
                f"{self.key!r} must be at most {_fmt(self.maximum)} "
                f"(got {_fmt(value)}). {self.help_text}".strip()
            )

    def in_range(self, raw: str) -> bool:
        """Non-raising form, for the read path where an exception is not an option."""
        try:
            self.validate(raw)
        except ValueError:
            return False
        return True


def _fmt(value: float) -> str:
    """Render a bound without a pointless trailing ``.0`` on whole numbers."""
    return str(int(value)) if float(value).is_integer() else str(value)


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
    # --- AI resilience -------------------------------------------------------
    # Every one of these is bounded. The upper bounds are not tidiness: a model
    # call happens inside a request or a job lease, and a timeout longer than
    # the lease means the worker is reaped mid-call and the work is retried
    # from the start, having already been paid for.
    ManagedKey(
        key="llm.timeout_seconds",
        label="Model call timeout (seconds)",
        group="AI",
        env_var="ZEUS_LLM_TIMEOUT_SECONDS",
        settings_path="llm.timeout_seconds",
        value_type="int",
        minimum=5,
        maximum=300,
        help_text=(
            "Must stay below the job lease, or a slow call is reaped and retried "
            "after we have already paid for it."
        ),
    ),
    ManagedKey(
        key="llm.max_attempts",
        label="Max attempts per call",
        group="AI",
        env_var="ZEUS_LLM_MAX_ATTEMPTS",
        settings_path="llm.max_attempts",
        value_type="int",
        minimum=1,
        maximum=10,
        help_text=(
            "Every attempt is billed. Raising this multiplies the cost of a "
            "failing model, it does not fix it."
        ),
    ),
    ManagedKey(
        key="llm.breaker_failure_threshold",
        label="Circuit breaker failure threshold",
        group="AI",
        env_var="ZEUS_LLM_BREAKER_FAILURE_THRESHOLD",
        settings_path="llm.breaker_failure_threshold",
        value_type="int",
        minimum=1,
        maximum=100,
        help_text=(
            "Consecutive failures before calls stop. Set too high, an outage is "
            "paid for in full before anything trips."
        ),
    ),
    ManagedKey(
        key="llm.breaker_recovery_seconds",
        label="Circuit breaker recovery (seconds)",
        group="AI",
        env_var="ZEUS_LLM_BREAKER_RECOVERY_SECONDS",
        settings_path="llm.breaker_recovery_seconds",
        value_type="float",
        minimum=1,
        maximum=3600,
    ),
    ManagedKey(
        key="llm.chunk_chars",
        label="Chunk size (characters)",
        group="AI",
        env_var="ZEUS_LLM_CHUNK_CHARS",
        settings_path="llm.chunk_chars",
        value_type="int",
        minimum=1_000,
        maximum=200_000,
        help_text=(
            "About 4 characters per token. Above the model's context window every "
            "call fails, so the ceiling is real."
        ),
    ),
    ManagedKey(
        key="llm.max_chunks",
        label="Max chunks per document",
        group="AI",
        env_var="ZEUS_LLM_MAX_CHUNKS",
        settings_path="llm.max_chunks",
        value_type="int",
        minimum=1,
        maximum=500,
        help_text=(
            "The ceiling on what one upload can cost. Removing it lets a single "
            "large file run up an unbounded bill."
        ),
    ),
    # --- Caching -------------------------------------------------------------
    # See the module docstring for why the config cache's own TTL is not here.
    ManagedKey(
        key="cache.membership_ttl_seconds",
        label="Membership cache TTL (seconds)",
        group="Caching",
        env_var="ZEUS_CACHE_MEMBERSHIP_TTL_SECONDS",
        settings_path="cache.membership_ttl_seconds",
        value_type="int",
        minimum=10,
        maximum=300,
        help_text=(
            "How long a removed member keeps access. This is an authorisation "
            "decision, which is why the ceiling is five minutes."
        ),
    ),
    ManagedKey(
        key="cache.entitlements_ttl_seconds",
        label="Entitlements cache TTL (seconds)",
        group="Caching",
        env_var="ZEUS_CACHE_ENTITLEMENTS_TTL_SECONDS",
        settings_path="cache.entitlements_ttl_seconds",
        value_type="int",
        minimum=30,
        maximum=900,
        help_text=(
            "Bounds how long a suspended tenant keeps working on another "
            "instance. Suspension invalidates directly, so this is the worst "
            "case, not the normal one."
        ),
    ),
    ManagedKey(
        key="cache.oauth_state_ttl_seconds",
        label="OAuth state TTL (seconds)",
        group="Caching",
        env_var="ZEUS_CACHE_OAUTH_STATE_TTL_SECONDS",
        settings_path="cache.oauth_state_ttl_seconds",
        value_type="int",
        minimum=60,
        maximum=1800,
        help_text=(
            "How long a half-finished Google sign-in stays resumable. Long "
            "windows widen the replay window for a stolen state value."
        ),
    ),
    ManagedKey(
        key="cache.model_price_ttl_seconds",
        label="Model price cache TTL (seconds)",
        group="Caching",
        env_var="ZEUS_CACHE_MODEL_PRICE_TTL_SECONDS",
        settings_path="cache.model_price_ttl_seconds",
        value_type="int",
        minimum=60,
        maximum=86_400,
        help_text=(
            "A price edit deletes the key outright, so this only bounds drift "
            "for a price changed some other way."
        ),
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
    #: Carried to the dashboard so the input can constrain itself and the
    #: operator learns the range before being refused, rather than after.
    value_type: ValueType = "string"
    minimum: float | None = None
    maximum: float | None = None


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
        """Resolve a managed key: database, then environment, then ``None``.

        A stored value that is out of bounds is discarded here and the
        environment applies instead. That is not redundant with the check in
        :meth:`set`: bounds are tightened over time, the table can be edited by
        hand, and a restore can bring back a value that was legal when it was
        written. Enforcing only on write means the one path that matters -- the
        value actually in use -- is the one path never checked.

        It falls back rather than raising because this runs on the request
        path. A bad row must degrade to the environment default, not take the
        platform down.
        """
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
        if stored is not None and not spec.in_range(stored):
            log.warning(
                "config.stored_value_out_of_bounds key=%s; using environment instead", key
            )
            stored = None
        if stored is not None:
            return stored
        return self._env.get(spec.env_var) or None

    async def set(self, key: str, value: str, *, updated_by: str | None = None) -> None:
        spec = managed_key(key)
        value = value.strip()
        if not value:
            raise ValueError(f"{key!r} cannot be set to an empty value; delete it instead.")
        # Bounds are checked here, before the write, so an out-of-range value
        # never reaches the database. Checking only at read time would mean the
        # operator's edit appeared to succeed and then quietly did nothing,
        # which is worse than refusing it.
        spec.validate(value)
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
                    value_type=spec.value_type,
                    minimum=spec.minimum,
                    maximum=spec.maximum,
                )
            )
        return out
