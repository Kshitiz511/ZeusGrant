"""Shared AI usage metering.

Every module records model usage the same way, into ``platform.ai_usage``, so
the platform owner can answer "which tenant costs what" with one query rather
than a union that grows with each module added.

Two invariants worth stating, because both were wrong before:

**Token counts are measured, never estimated.** The previous implementation
stored ``len(text) // 4``. That is a plausible-looking number with no
relationship to the invoice, and it silently ignored output tokens entirely --
which on a reasoning model are frequently the larger half of the bill. Providers
report exact usage on every response; those are the numbers recorded here.

**An unknown cost is NULL, not zero.** If a model has no configured price, the
usage row still records tokens but leaves ``cost_usd`` empty. Writing 0.00 would
make an unpriced model look free in every rollup, which is precisely the error
that hides a runaway bill.

**Model names are normalised before use.** Callers disagreed: contract
extraction passed ``gpt-5-mini`` while grant enrichment passed
``openai:gpt-5-mini``. Both name the same model and the same invoice line, but
left alone they would miss the price row and group separately in every rollup.
The provider prefix is stripped here, once, rather than relying on every future
caller to remember the convention.

Writing across the schema boundary into ``platform`` is deliberate. The
alternative -- each module keeping its own table and platform-core unioning them
-- makes the owner's rollup O(modules) to maintain, and the module tables are
under FORCE RLS, so a cross-tenant aggregate would need a policy hole. This
table is an append-only ledger, so a shared sink carries little coupling risk:
modules only ever insert.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal

from zeus_adapters.interfaces import Cache, Database

log = logging.getLogger(__name__)

TOKENS_PER_MILLION = Decimal(1_000_000)

#: Cache namespace for model prices. Shared with the admin router, which deletes
#: keys under it when a price is edited.
PRICE_CACHE_PREFIX = "modelprice:"

#: Prices change when someone edits them, which is rare, so this is generous.
#: It is a backstop, not the mechanism: the admin route deletes the key on write,
#: so an edit is visible immediately. The TTL only bounds how long a *missed*
#: invalidation can be wrong -- for instance if Redis was briefly unreachable
#: during the edit.
PRICE_CACHE_TTL_SECONDS = 900

#: Stored in place of a price for a model that has no row. Without this, every
#: call for an unpriced model would miss the cache and hit the database -- and
#: an unpriced model is usually one that was *just* introduced and is being
#: called in a loop, which is exactly when the extra load is least welcome.
#: A plain empty string would be ambiguous with a corrupt entry.
_NO_PRICE = "none"


def price_cache_key(model: str) -> str:
    """Cache key for one model's price. Callers must pass a normalised name."""
    return f"{PRICE_CACHE_PREFIX}{model}"


def normalise_model(model: str) -> str:
    """Strip a ``provider:`` prefix and lower-case the result.

    ``platform.model_pricing`` is keyed on the unqualified model name, because
    that is what the provider's price list and the invoice both use. Splitting
    on the last colon rather than the first keeps names containing a colon
    intact if a provider ever ships one.
    """
    name = (model or "").strip()
    if ":" in name:
        name = name.rsplit(":", 1)[-1].strip()
    return name.lower()


@dataclass(frozen=True, slots=True)
class ModelPrice:
    input_per_million_usd: Decimal
    output_per_million_usd: Decimal


def compute_cost(
    price: ModelPrice | None,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> Decimal | None:
    """Cost in USD, or ``None`` when it cannot be known honestly.

    Returns ``None`` if the model has no configured price *or* if the provider
    reported no usage. Either way the truthful answer is "unknown", and a zero
    would be indistinguishable from a genuinely free call.
    """
    if price is None:
        return None
    if prompt_tokens is None and completion_tokens is None:
        return None
    prompt = Decimal(prompt_tokens or 0)
    completion = Decimal(completion_tokens or 0)
    return (
        prompt * price.input_per_million_usd / TOKENS_PER_MILLION
        + completion * price.output_per_million_usd / TOKENS_PER_MILLION
    ).quantize(Decimal("0.000001"))


class AiUsageRecorder:
    def __init__(
        self,
        db: Database,
        cache: Cache | None = None,
        ttl_seconds: Callable[[], int] | None = None,
    ) -> None:
        self._db = db
        self._cache = cache
        # A callable for the same reason the cache replaced the dict: this
        # object outlives any request, so a value captured at construction
        # would be pinned to boot time.
        self._ttl_seconds = ttl_seconds or (lambda: PRICE_CACHE_TTL_SECONDS)

    async def price_for(self, model: str) -> ModelPrice | None:
        """The configured price for a model, or None if it has none.

        Cached in the shared :class:`Cache` rather than on this instance.

        The previous implementation memoised into ``self._prices``, a plain
        dict with no expiry and no invalidation (defect D7). Because the
        recorder is a ``cached_property`` on a container that lives as long as
        the process, a price edited in the admin UI did not take effect until
        the serverless instance happened to recycle -- which could be hours,
        and differed per instance, so two identical calls could be costed
        differently at the same moment. Moving it here means an edit deletes
        one key and every instance sees the new price at once.

        With no cache configured this reads through on every call. That is the
        deliberate fallback: a single indexed lookup against one small table,
        next to an LLM round trip measured in seconds, is not a cost worth
        risking staleness for. Reading through is slower and always right; the
        unbounded dict was faster and sometimes wrong.
        """
        model = normalise_model(model)

        if self._cache is not None:
            cached = await self._cache.get(price_cache_key(model))
            if cached == _NO_PRICE:
                return None
            if cached is not None:
                try:
                    raw_in, raw_out = cached.split(",", 1)
                    return ModelPrice(
                        input_per_million_usd=Decimal(raw_in),
                        output_per_million_usd=Decimal(raw_out),
                    )
                except (ValueError, ArithmeticError):
                    # An unparseable entry is treated as a miss rather than an
                    # error. A malformed cache value must never be able to stop
                    # a model call that has already been paid for.
                    log.warning("metering.price_cache_corrupt model=%s", model)

        row = await self._db.fetch_one(
            "SELECT input_per_million_usd, output_per_million_usd "
            "FROM platform.model_pricing WHERE model = $1",
            model,
        )
        price = (
            ModelPrice(
                input_per_million_usd=Decimal(str(row["input_per_million_usd"])),
                output_per_million_usd=Decimal(str(row["output_per_million_usd"])),
            )
            if row
            else None
        )

        if self._cache is not None:
            value = (
                _NO_PRICE
                if price is None
                else f"{price.input_per_million_usd},{price.output_per_million_usd}"
            )
            await self._cache.set(
                price_cache_key(model), value, ttl_seconds=self._ttl_seconds()
            )
        return price

    async def record(
        self,
        *,
        tenant_id: str | None,
        module_id: str,
        operation: str,
        model: str,
        actor_id: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        latency_ms: int | None = None,
        succeeded: bool = True,
        error: str | None = None,
        request_id: str | None = None,
    ) -> None:
        """Record one billable model call.

        ``tenant_id`` may be ``None`` for work done on behalf of the platform
        rather than a customer -- shared catalogue enrichment being the case
        this exists for. Attributing that cost to whichever tenant happened to
        trigger the batch would put shared infrastructure spend on one
        customer's usage page, so it is recorded as unattributable instead.

        Never raises. Metering must not be able to fail a user's request that
        already succeeded -- losing a usage row costs us accounting accuracy,
        while raising here would lose the user's work.
        """
        try:
            model = normalise_model(model)
            price = await self.price_for(model)
            cost = compute_cost(price, prompt_tokens, completion_tokens)
            await self._db.execute(
                """
                INSERT INTO platform.ai_usage
                    (tenant_id, actor_id, module_id, operation, model,
                     prompt_tokens, completion_tokens, cost_usd,
                     latency_ms, succeeded, error, request_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                tenant_id,
                actor_id,
                module_id,
                operation,
                model,
                prompt_tokens,
                completion_tokens,
                cost,
                latency_ms,
                succeeded,
                (error or None) and str(error)[:1000],
                request_id,
            )
            if price is None:
                # Surfaced in the admin dashboard as "unpriced models"; without
                # this the owner's spend figure is quietly incomplete.
                log.warning("ai_usage.unpriced_model model=%s", model)
        except Exception:
            log.exception("ai_usage.record_failed tenant=%s model=%s", tenant_id, model)
