"""Usage read path: cost honesty, attribution, and period boundaries.

The rule being defended in most of these is that an unknown cost stays
unknown. It would be trivial -- and wrong -- for any layer here to turn a NULL
into 0.00: the sum would look complete, the dashboard would look calm, and a
model nobody had priced could run up an unbounded bill without moving a number
on screen. Several of these tests exist only to make that failure loud.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_platform_core.repositories.usage import UsageRepository
from zeus_service_kit.metering import (
    AiUsageRecorder,
    ModelPrice,
    compute_cost,
    normalise_model,
    price_cache_key,
)

TENANT = "11111111-1111-1111-1111-111111111111"
NOW = datetime(2026, 9, 16, tzinfo=UTC)


# --- model naming ----------------------------------------------------------
# The two callers disagreed: contract extraction passed "gpt-5-mini", grant
# enrichment passed "openai:gpt-5-mini". Both name one model and one invoice
# line, so both must resolve to one price row and one group in every rollup.


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("gpt-5-mini", "gpt-5-mini"),
        ("openai:gpt-5-mini", "gpt-5-mini"),
        ("anthropic:claude-sonnet-4", "claude-sonnet-4"),
        ("  OpenAI:GPT-5-Mini  ", "gpt-5-mini"),
        ("", ""),
    ],
)
def test_model_names_normalise_to_the_unqualified_name(given: str, expected: str) -> None:
    assert normalise_model(given) == expected


async def test_a_provider_qualified_model_finds_its_price() -> None:
    """The regression that would otherwise leave enrichment permanently unpriced."""
    db = FakeDatabase()
    db.on_fetch_one(
        "FROM platform.model_pricing",
        lambda args: {"input_per_million_usd": "0.25", "output_per_million_usd": "2.00"},
    )

    price = await AiUsageRecorder(db).price_for("openai:gpt-5-mini")

    assert price is not None
    assert price.input_per_million_usd == Decimal("0.25")


async def test_the_price_cache_is_keyed_on_the_normalised_name() -> None:
    """Otherwise the same model is looked up once per spelling.

    The cache is shared (a ``Cache``, not a per-instance dict) so that an
    admin price edit takes effect everywhere at once -- defect D7. This
    asserts the three spellings collapse onto one key, and does it through a
    second recorder to prove the entry really is shared rather than memoised.
    """
    db = FakeDatabase()
    cache = MemoryCache()
    calls = {"n": 0}

    def _price(args):
        calls["n"] += 1
        return {"input_per_million_usd": "0.25", "output_per_million_usd": "2.00"}

    db.on_fetch_one("FROM platform.model_pricing", _price)

    await AiUsageRecorder(db, cache).price_for("gpt-5-mini")
    await AiUsageRecorder(db, cache).price_for("openai:gpt-5-mini")
    await AiUsageRecorder(db, cache).price_for("GPT-5-MINI")

    assert calls["n"] == 1


async def test_deleting_the_cache_key_makes_a_price_edit_visible() -> None:
    """The point of D7: an edit must not wait for the instance to recycle."""
    db = FakeDatabase()
    cache = MemoryCache()
    prices = {"in": "0.25"}
    db.on_fetch_one(
        "FROM platform.model_pricing",
        lambda args: {
            "input_per_million_usd": prices["in"],
            "output_per_million_usd": "2.00",
        },
    )
    recorder = AiUsageRecorder(db, cache)

    first = await recorder.price_for("gpt-5-mini")
    prices["in"] = "9.00"
    assert first is not None
    # Still the old price: that is the cache doing its job, not the bug.
    stale = await recorder.price_for("gpt-5-mini")
    assert stale is not None and stale.input_per_million_usd == Decimal("0.25")

    await cache.delete(price_cache_key("gpt-5-mini"))

    fresh = await recorder.price_for("gpt-5-mini")
    assert fresh is not None and fresh.input_per_million_usd == Decimal("9.00")


async def test_a_model_with_no_price_is_cached_as_absent() -> None:
    """Otherwise every unpriced call pays for a database round trip."""
    db = FakeDatabase()
    cache = MemoryCache()
    calls = {"n": 0}

    def _none(args):
        calls["n"] += 1
        return None

    db.on_fetch_one("FROM platform.model_pricing", _none)
    recorder = AiUsageRecorder(db, cache)

    assert await recorder.price_for("unpriced") is None
    assert await recorder.price_for("unpriced") is None
    assert calls["n"] == 1


async def test_a_corrupt_cache_entry_falls_back_to_the_database() -> None:
    """A bad cache value must never fail a call the customer already paid for."""
    db = FakeDatabase()
    cache = MemoryCache()
    db.on_fetch_one(
        "FROM platform.model_pricing",
        lambda args: {"input_per_million_usd": "0.25", "output_per_million_usd": "2"},
    )
    await cache.set(price_cache_key("gpt-5-mini"), "not-a-price")

    price = await AiUsageRecorder(db, cache).price_for("gpt-5-mini")

    assert price is not None
    assert price.input_per_million_usd == Decimal("0.25")


# --- cost arithmetic -------------------------------------------------------


def test_cost_is_computed_from_both_halves_of_the_bill() -> None:
    """Output tokens are frequently the larger half and must not be dropped."""
    price = ModelPrice(
        input_per_million_usd=Decimal("0.25"), output_per_million_usd=Decimal("2.00")
    )

    cost = compute_cost(price, 1_000_000, 1_000_000)

    assert cost == Decimal("2.250000")


def test_an_unpriced_model_costs_an_unknown_amount_not_zero() -> None:
    assert compute_cost(None, 1_000_000, 1_000_000) is None


def test_a_priced_model_with_no_reported_usage_is_also_unknown() -> None:
    """The provider returning nothing is a fact, not a free call."""
    price = ModelPrice(
        input_per_million_usd=Decimal("0.25"), output_per_million_usd=Decimal("2.00")
    )

    assert compute_cost(price, None, None) is None


def test_a_genuinely_zero_token_call_costs_zero() -> None:
    """Distinct from the case above: here the provider did report, and reported 0."""
    price = ModelPrice(
        input_per_million_usd=Decimal("0.25"), output_per_million_usd=Decimal("2.00")
    )

    assert compute_cost(price, 0, 0) == Decimal("0.000000")


# --- recording -------------------------------------------------------------


async def test_platform_work_is_recorded_against_no_tenant() -> None:
    """Shared catalogue enrichment must not land on one customer's bill."""
    db = FakeDatabase()
    captured: list[tuple] = []
    db.on_execute("INSERT INTO platform.ai_usage", lambda args: captured.append(args))

    await AiUsageRecorder(db).record(
        tenant_id=None,
        module_id="grant_intelligence",
        operation="read_eligibility",
        model="openai:gpt-5-mini",
        prompt_tokens=100,
    )

    assert captured, "no usage row was written"
    args = captured[0]
    assert args[0] is None, "platform work was attributed to a tenant"
    assert args[4] == "gpt-5-mini", "model name was stored unnormalised"


async def test_metering_never_breaks_the_work_it_measures() -> None:
    """A usage row is worth less than the user's result. Losing it is the lesser harm."""
    db = FakeDatabase()

    def _boom(args):
        raise RuntimeError("ledger unavailable")

    db.on_execute("INSERT INTO platform.ai_usage", _boom)

    await AiUsageRecorder(db).record(
        tenant_id=TENANT,
        module_id="grant_intelligence",
        operation="read_eligibility",
        model="gpt-5-mini",
        prompt_tokens=100,
    )


# --- read path -------------------------------------------------------------


def _repo_returning(row: dict) -> UsageRepository:
    db = FakeDatabase()
    db.on_fetch_one("FROM platform.ai_usage", lambda args: row)
    return UsageRepository(db)


async def test_totals_report_how_much_of_the_cost_is_unknown() -> None:
    """A partial total presented as complete is the failure this guards."""
    repo = _repo_returning(
        {
            "calls": 10,
            "failures": 0,
            "prompt_tokens": 500,
            "completion_tokens": 500,
            "total_tokens": 1000,
            "cost_usd": Decimal("4.10"),
            "unpriced_calls": 3,
        }
    )

    totals = await repo.tenant_totals(TENANT, since=NOW - timedelta(days=30), until=NOW)

    assert totals["cost_usd"] == Decimal("4.10")
    assert totals["unpriced_calls"] == 3, "the caller cannot tell the total is incomplete"


async def test_a_wholly_unpriced_period_reports_null_cost_not_zero() -> None:
    repo = _repo_returning(
        {
            "calls": 10,
            "failures": 0,
            "prompt_tokens": 500,
            "completion_tokens": 500,
            "total_tokens": 1000,
            "cost_usd": None,
            "unpriced_calls": 10,
        }
    )

    totals = await repo.tenant_totals(TENANT, since=NOW - timedelta(days=30), until=NOW)

    assert totals["cost_usd"] is None, "unknown cost was rendered as a number"


async def test_tenant_queries_are_scoped_by_an_explicit_tenant_id() -> None:
    """Platform-wide rows have a NULL tenant and must never join a tenant's total."""
    db = FakeDatabase()
    seen: list[tuple] = []

    def _capture(args):
        seen.append(args)
        return {
            "calls": 0,
            "failures": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": None,
            "unpriced_calls": 0,
        }

    db.on_fetch_one("FROM platform.ai_usage", _capture)

    await UsageRepository(db).tenant_totals(
        TENANT, since=NOW - timedelta(days=30), until=NOW
    )

    assert seen[0][0] == TENANT
