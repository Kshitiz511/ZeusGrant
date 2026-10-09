"""AI spend ceiling (Phase 7, DEC-5): refuse once the month's usage hits the cap."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from zeus_contract_compliance.routers import MODULE_ID, _enforce_ai_budget

TENANT = "11111111-1111-1111-1111-111111111111"


def container(limits: dict, tokens: int, cost: float):
    calls: list[str] = []

    async def claims_for(tenant_id):
        return {"modules": {MODULE_ID: {"limits": limits}}}

    async def ai_usage_this_month(tenant_id, module_id):
        calls.append(module_id)
        return tokens, cost

    c = SimpleNamespace(
        security=SimpleNamespace(claims_for=claims_for),
        documents=SimpleNamespace(ai_usage_this_month=ai_usage_this_month),
    )
    return c, calls


@pytest.mark.asyncio
async def test_unlimited_plan_never_reads_usage():
    c, calls = container({}, 10**9, 10**6)
    await _enforce_ai_budget(c, TENANT)
    assert calls == []


@pytest.mark.asyncio
async def test_under_cost_cap_is_allowed():
    c, _ = container({"ai_cost_per_month_usd": 5}, 0, 4.99)
    await _enforce_ai_budget(c, TENANT)


@pytest.mark.asyncio
async def test_at_cost_cap_is_refused_with_402():
    c, _ = container({"ai_cost_per_month_usd": 5}, 0, 5.0)
    with pytest.raises(HTTPException) as err:
        await _enforce_ai_budget(c, TENANT)
    assert err.value.status_code == 402
    assert err.value.detail["limit_key"] == "ai_cost_per_month_usd"


@pytest.mark.asyncio
async def test_token_cap_is_enforced_independently():
    c, _ = container({"tokens_per_month": 1000, "ai_cost_per_month_usd": 5}, 1000, 0.1)
    with pytest.raises(HTTPException) as err:
        await _enforce_ai_budget(c, TENANT)
    assert err.value.detail["limit_key"] == "tokens_per_month"
