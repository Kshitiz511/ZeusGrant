"""AI usage metering: cost arithmetic and the honesty of unknowns.

These assertions exist because the failure mode here is silent. A wrong cost
does not crash anything -- it just quietly misprices a tier or hides a runaway
bill until the invoice arrives.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_service_kit.metering import AiUsageRecorder, ModelPrice, compute_cost

PRICE = ModelPrice(
    input_per_million_usd=Decimal("0.25"),
    output_per_million_usd=Decimal("2.00"),
)


def test_cost_is_computed_from_both_input_and_output_tokens():
    # 1M input at $0.25 + 1M output at $2.00
    assert compute_cost(PRICE, 1_000_000, 1_000_000) == Decimal("2.250000")


def test_output_tokens_are_not_ignored():
    # The previous implementation recorded input only. Output is priced 8x
    # higher here, so ignoring it would under-report by most of the bill.
    input_only = compute_cost(PRICE, 1_000_000, 0)
    with_output = compute_cost(PRICE, 1_000_000, 1_000_000)
    assert with_output > input_only
    assert with_output - input_only == Decimal("2.000000")


def test_small_token_counts_do_not_round_to_zero():
    # Six decimal places: a single cheap call must still register, otherwise
    # per-tenant totals drift toward zero one rounding at a time.
    cost = compute_cost(PRICE, 1_000, 100)
    assert cost > 0
    assert cost == Decimal("0.000450")


def test_unpriced_model_yields_none_not_zero():
    # Zero would make an unpriced model look free in every rollup -- exactly
    # the error that hides a runaway bill.
    assert compute_cost(None, 1_000, 100) is None


def test_absent_provider_usage_yields_none_not_zero():
    assert compute_cost(PRICE, None, None) is None


def test_partial_usage_is_still_priced():
    # Some providers report only one side; price what we know rather than
    # discarding the call entirely.
    assert compute_cost(PRICE, 1_000_000, None) == Decimal("0.250000")


class FakeDb:
    def __init__(self, price_row=None, fail_on_execute=False):
        self._price_row = price_row
        self.inserts: list[tuple] = []
        self.fetches = 0
        self._fail = fail_on_execute

    async def fetch_one(self, sql, *args):
        self.fetches += 1
        return self._price_row

    async def execute(self, sql, *args):
        if self._fail:
            raise RuntimeError("database is down")
        self.inserts.append(args)


@pytest.mark.asyncio
async def test_records_tokens_and_cost():
    db = FakeDb({"input_per_million_usd": "0.25", "output_per_million_usd": "2.00"})
    await AiUsageRecorder(db).record(
        tenant_id="t1",
        module_id="contract_compliance",
        operation="extract",
        model="gpt-5-mini",
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    )
    (args,) = db.inserts
    assert args[0] == "t1"
    assert args[5] == 1_000_000  # prompt
    assert args[6] == 1_000_000  # completion
    assert args[7] == Decimal("2.250000")  # cost


@pytest.mark.asyncio
async def test_unpriced_model_still_records_the_tokens():
    # Losing the token count as well would make the gap unrecoverable; the
    # price can be backfilled later, the usage cannot.
    db = FakeDb(price_row=None)
    await AiUsageRecorder(db).record(
        tenant_id="t1",
        module_id="m",
        operation="op",
        model="unknown-model",
        prompt_tokens=500,
        completion_tokens=100,
    )
    (args,) = db.inserts
    assert args[5] == 500
    assert args[7] is None


@pytest.mark.asyncio
async def test_price_lookup_is_cached_in_the_shared_cache():
    """Extraction fans out over chunks; a lookup per chunk would be pure waste.

    The cache is now shared rather than per-recorder (defect D7) so that an
    admin price edit is visible to every instance immediately. With no cache
    supplied the recorder deliberately reads through -- one indexed lookup
    against a tiny table is a price worth paying to never be wrong.
    """
    db = FakeDb({"input_per_million_usd": "1", "output_per_million_usd": "1"})
    recorder = AiUsageRecorder(db, MemoryCache())
    for _ in range(3):
        await recorder.record(
            tenant_id="t", module_id="m", operation="o", model="same", prompt_tokens=1
        )
    assert db.fetches == 1


@pytest.mark.asyncio
async def test_without_a_cache_the_recorder_reads_through():
    """Slower and always right, rather than faster and sometimes stale."""
    db = FakeDb({"input_per_million_usd": "1", "output_per_million_usd": "1"})
    recorder = AiUsageRecorder(db)
    for _ in range(3):
        await recorder.record(
            tenant_id="t", module_id="m", operation="o", model="same", prompt_tokens=1
        )
    assert db.fetches == 3


@pytest.mark.asyncio
async def test_metering_failure_never_propagates():
    # The user's work already succeeded. Losing a usage row costs accounting
    # accuracy; raising here would lose their result.
    db = FakeDb({"input_per_million_usd": "1", "output_per_million_usd": "1"}, fail_on_execute=True)
    await AiUsageRecorder(db).record(
        tenant_id="t", module_id="m", operation="o", model="x", prompt_tokens=1
    )
