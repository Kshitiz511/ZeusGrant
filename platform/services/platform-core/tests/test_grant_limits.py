"""Plan-limit resolution in Grant Intelligence — defect D22.

Every ``*_enterprise`` plan is seeded with **zero** ``plan_limits`` rows,
because under DEC-10 an absent key means unlimited. ``GrantService`` read that
absence as "configuration gap, fall back to the free tier", so an enterprise
tenant was capped at three scans a month and twenty-five visible matches — the
free-tier allowance, on the most expensive plan on the price list. Contract
Compliance read the identical condition as unlimited. Two modules, the same
data, opposite answers.

These tests pin the three cases apart, because the bug was only possible while
they were indistinguishable: unlimited, a stated ceiling, and no entitlement.
"""

from __future__ import annotations

import pytest
from zeus_platform_core.domain.models import EntitlementClaims, ModuleEntitlement
from zeus_platform_core.services.grant_service import (
    DEFAULT_MATCHES_VISIBLE,
    DEFAULT_SCANS_PER_MONTH,
    LIMIT_MATCHES_VISIBLE,
    LIMIT_SCANS_PER_MONTH,
    MODULE_ID,
    UNLIMITED_MATCHES_WINDOW,
    GrantService,
    LimitExceeded,
    ProfileIncomplete,
)

TENANT = "11111111-1111-1111-1111-111111111111"


# --- fakes ------------------------------------------------------------------


def claims(limits: dict[str, int | None] | None, *, status: str = "active") -> EntitlementClaims:
    """Build claims for the module, or claims with no module at all."""
    if limits is None:
        return EntitlementClaims(tenant_id=TENANT)
    return EntitlementClaims(
        tenant_id=TENANT,
        modules={
            MODULE_ID: ModuleEntitlement(
                module_id=MODULE_ID, plan_id="p", status=status, limits=limits
            )
        },
    )


class FakeEntitlements:
    def __init__(self, value: EntitlementClaims | Exception) -> None:
        self._value = value

    async def get_claims(self, tenant_id: str) -> EntitlementClaims:
        if isinstance(self._value, Exception):
            raise self._value
        return self._value


class FakeProfile:
    is_scoreable = True


class FakeJob:
    id = "job-1"
    status = "queued"
    attempts = 0


class FakeRepo:
    """Records the window the service asked for, so truncation is observable."""

    def __init__(self, total: int = 312) -> None:
        self.total = total
        self.list_calls: list[dict[str, int]] = []

    async def get_profile(self, tenant_id: str) -> FakeProfile:
        return FakeProfile()

    async def list_matches(self, tenant_id: str, *, limit: int, offset: int, **kw):
        self.list_calls.append({"limit": limit, "offset": offset})
        return [{"id": str(i)} for i in range(limit)]

    async def count_matches(self, tenant_id: str) -> int:
        return self.total


class FakeJobs:
    async def enqueue(self, kind: str, **kw) -> FakeJob:
        return FakeJob()


class FakeDb:
    def __init__(self, used: int = 0) -> None:
        self.used = used

    async def fetch_one(self, query: str, *args):
        return {"n": self.used}


def service(
    limits: dict[str, int | None] | None,
    *,
    used: int = 0,
    total: int = 312,
    status: str = "active",
    entitlements_error: Exception | None = None,
) -> tuple[GrantService, FakeRepo]:
    repo = FakeRepo(total=total)
    ent = FakeEntitlements(entitlements_error or claims(limits, status=status))
    return (
        GrantService(opportunities=repo, jobs=FakeJobs(), entitlements=ent, db=FakeDb(used)),
        repo,
    )


# --- the three cases, on scans ----------------------------------------------


@pytest.mark.asyncio
async def test_enterprise_plan_with_no_limit_rows_is_unlimited_on_scans():
    """The headline defect: no rows means unlimited, not three."""
    svc, _ = service({}, used=99)
    usage = await svc.scan_usage(TENANT)
    assert usage == {"used": 99, "limit": None, "remaining": None}


@pytest.mark.asyncio
async def test_an_explicit_null_limit_is_also_unlimited():
    """DEC-10 treats a NULL value the same as an absent key."""
    svc, _ = service({LIMIT_SCANS_PER_MONTH: None}, used=99)
    assert (await svc.scan_usage(TENANT))["limit"] is None


@pytest.mark.asyncio
async def test_a_stated_ceiling_is_still_enforced():
    """Fixing unlimited must not quietly unlimit everybody."""
    svc, _ = service({LIMIT_SCANS_PER_MONTH: 3}, used=1)
    assert await svc.scan_usage(TENANT) == {"used": 1, "limit": 3, "remaining": 2}


@pytest.mark.asyncio
async def test_a_tenant_without_the_module_gets_the_free_tier_number():
    """Not unlimited — the absence of an entitlement is not a generous plan."""
    svc, _ = service(None, used=0)
    usage = await svc.scan_usage(TENANT)
    assert usage["limit"] == DEFAULT_SCANS_PER_MONTH


@pytest.mark.asyncio
async def test_an_inactive_entitlement_gets_the_free_tier_number():
    """A cancelled plan's limits must not keep applying as 'unlimited'."""
    svc, _ = service({}, status="cancelled")
    assert (await svc.scan_usage(TENANT))["limit"] == DEFAULT_SCANS_PER_MONTH


@pytest.mark.asyncio
async def test_unreadable_entitlements_fall_back_rather_than_failing_open():
    """If the entitlement store is down, do not hand out unlimited scans."""
    svc, _ = service({}, entitlements_error=RuntimeError("redis down"))
    assert (await svc.scan_usage(TENANT))["limit"] == DEFAULT_SCANS_PER_MONTH


# --- enforcement ------------------------------------------------------------


@pytest.mark.asyncio
async def test_unlimited_plan_can_scan_far_past_the_default():
    svc, _ = service({}, used=500)
    result = await svc.request_scan(TENANT)
    assert result.job_id == "job-1"
    assert result.scans_limit is None
    assert result.scans_used == 501


@pytest.mark.asyncio
async def test_capped_plan_is_refused_at_the_ceiling():
    svc, _ = service({LIMIT_SCANS_PER_MONTH: 3}, used=3)
    with pytest.raises(LimitExceeded) as err:
        await svc.request_scan(TENANT)
    assert err.value.limit == 3
    assert err.value.used == 3


@pytest.mark.asyncio
async def test_capped_plan_below_the_ceiling_still_scans():
    svc, _ = service({LIMIT_SCANS_PER_MONTH: 3}, used=2)
    assert (await svc.request_scan(TENANT)).scans_limit == 3


@pytest.mark.asyncio
async def test_profile_check_runs_before_the_limit_check():
    """An incomplete profile must not burn a scan or report a limit error."""

    class Unscoreable(FakeProfile):
        is_scoreable = False

    svc, repo = service({LIMIT_SCANS_PER_MONTH: 3}, used=99)
    repo.get_profile = lambda tenant_id: _wrap(Unscoreable())  # type: ignore[assignment]
    with pytest.raises(ProfileIncomplete):
        await svc.request_scan(TENANT)


async def _wrap(value):
    return value


# --- the three cases, on visible matches ------------------------------------


@pytest.mark.asyncio
async def test_unlimited_plan_is_not_reported_as_truncated():
    """`truncated` drives the upsell banner. Showing it to the customer who
    already bought the top plan is the visible face of D22."""
    svc, repo = service({}, total=312)
    page = await svc.list_matches(TENANT, limit=50, offset=0)
    assert page["visible_limit"] is None
    assert page["truncated"] is False
    assert repo.list_calls[0]["limit"] == 50


@pytest.mark.asyncio
async def test_unlimited_plan_can_page_beyond_the_free_tier_window():
    """Offset 100 returned nothing at all while the cap was 25."""
    svc, repo = service({}, total=312)
    page = await svc.list_matches(TENANT, limit=50, offset=100)
    assert repo.list_calls[0] == {"limit": 50, "offset": 100}
    assert page["matches"]


@pytest.mark.asyncio
async def test_unlimited_paging_still_stops_at_the_window():
    """Unlimited is an entitlement, not permission to run an unbounded query."""
    svc, repo = service({}, total=50_000)
    await svc.list_matches(TENANT, limit=50, offset=UNLIMITED_MATCHES_WINDOW - 10)
    assert repo.list_calls[0]["limit"] == 10


@pytest.mark.asyncio
async def test_capped_plan_truncates_and_says_so():
    svc, repo = service({LIMIT_MATCHES_VISIBLE: 25}, total=312)
    page = await svc.list_matches(TENANT, limit=50, offset=0)
    assert page["visible_limit"] == 25
    assert page["truncated"] is True
    assert repo.list_calls[0]["limit"] == 25


@pytest.mark.asyncio
async def test_capped_plan_serves_nothing_past_its_window():
    svc, repo = service({LIMIT_MATCHES_VISIBLE: 25}, total=312)
    page = await svc.list_matches(TENANT, limit=50, offset=25)
    assert page["matches"] == []
    assert repo.list_calls == []


@pytest.mark.asyncio
async def test_module_less_tenant_still_sees_the_free_tier_window():
    svc, _ = service(None, total=312)
    page = await svc.list_matches(TENANT, limit=50, offset=0)
    assert page["visible_limit"] == DEFAULT_MATCHES_VISIBLE
    assert page["truncated"] is True


# --- the helper the fix rests on --------------------------------------------


def test_limit_ceiling_separates_unlimited_from_missing_entitlement():
    """`limit()` returns None for both. That conflation *was* the defect."""
    unlimited = claims({})
    assert unlimited.limit(MODULE_ID, LIMIT_SCANS_PER_MONTH) is None
    assert unlimited.limit_ceiling(MODULE_ID, LIMIT_SCANS_PER_MONTH, fallback=3) is None

    none = claims(None)
    assert none.limit(MODULE_ID, LIMIT_SCANS_PER_MONTH) is None
    assert none.limit_ceiling(MODULE_ID, LIMIT_SCANS_PER_MONTH, fallback=3) == 3


def test_limit_ceiling_returns_a_stated_ceiling_unchanged():
    c = claims({LIMIT_SCANS_PER_MONTH: 7})
    assert c.limit_ceiling(MODULE_ID, LIMIT_SCANS_PER_MONTH, fallback=3) == 7


def test_limit_ceiling_ignores_limits_on_an_inactive_entitlement():
    c = claims({LIMIT_SCANS_PER_MONTH: 500}, status="cancelled")
    assert c.limit_ceiling(MODULE_ID, LIMIT_SCANS_PER_MONTH, fallback=3) == 3
