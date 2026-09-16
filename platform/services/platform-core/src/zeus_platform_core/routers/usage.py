"""Usage endpoints: what this workspace consumed, and what it cost.

The read side of ``platform.ai_usage``, which has been written to since
migration 0006 and read by nothing until now.

Two deliberate choices about who sees what:

**Totals are visible to any member; per-seat attribution is not.** A member
seeing the workspace's overall consumption is ordinary transparency -- they can
see their plan limits already. A member seeing a colleague's individual spend is
workplace surveillance, so that one is admin-only.

**Cost may be null, and the API says so rather than rounding it away.** Every
cost figure is paired with ``unpriced_calls``. When that is non-zero the total
is incomplete, and the client must render it as such -- "$4.10 +" or "partly
unknown", never a clean "$4.10" that hides a model nobody has priced.

Not to be confused with ``GET /grants/usage``, which answers a different
question: how much of the plan's *scan allowance* is left. That one is about
quota, this one is about money and tokens. The similar names are unfortunate;
renaming the older route would break the console for no benefit.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from zeus_platform_core.security import ContainerDep, TenantAdminDep, TenantIdDep

router = APIRouter(prefix="/usage", tags=["usage"])

#: A period longer than this is a report, not a dashboard, and scanning it on
#: a request path punishes every other caller sharing the connection pool.
MAX_DAYS = 366
DEFAULT_DAYS = 30


class Totals(BaseModel):
    calls: int = 0
    failures: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    #: ``None`` means nothing in this period had a configured price. It is not
    #: zero, and a client that renders it as "$0.00" is lying to the user.
    cost_usd: float | None = None
    #: How many calls contributed no cost. Non-zero means ``cost_usd`` is a
    #: lower bound, not a total.
    unpriced_calls: int = 0


class ActorUsage(Totals):
    actor_id: str | None = None
    email: str | None = None
    full_name: str | None = None


class ModuleUsage(Totals):
    module_id: str


class DayPoint(BaseModel):
    day: str
    calls: int = 0
    total_tokens: int = 0
    cost_usd: float | None = None
    unpriced_calls: int = 0


class UsageResponse(BaseModel):
    since: datetime
    until: datetime
    totals: Totals
    by_module: list[ModuleUsage]
    series: list[DayPoint]


def _period(days: int) -> tuple[datetime, datetime]:
    """A half-open ``[since, until)`` window ending at the start of tomorrow.

    Ending at tomorrow's boundary rather than "now" keeps today's partial day
    in the window -- a user who ran something an hour ago expects to see it --
    while leaving the interval half-open so two adjacent periods summed
    together never double-count a row on the boundary.
    """
    if days < 1 or days > MAX_DAYS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"days must be between 1 and {MAX_DAYS}.",
        )
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    until = today + timedelta(days=1)
    return until - timedelta(days=days + 1), until


def _money(value) -> float | None:
    """Decimal to float for JSON, preserving null.

    Float is acceptable at the edge because this is a display figure. The
    arithmetic itself happens in Postgres over ``numeric``, so no rounding
    error accumulates in the sum -- only in its rendering.
    """
    return None if value is None else float(value)


def _totals(row: dict) -> dict:
    return {**row, "cost_usd": _money(row.get("cost_usd"))}


@router.get("/me", response_model=UsageResponse)
async def my_usage(
    container: ContainerDep,
    tenant_id: TenantIdDep,
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
) -> UsageResponse:
    """Workspace totals, split by module, with a daily series for the chart."""
    since, until = _period(days)
    totals = await container.usage.tenant_totals(tenant_id, since=since, until=until)
    by_module = await container.usage.by_module(tenant_id, since=since, until=until)
    series = await container.usage.daily_series(tenant_id, since=since, until=until)
    return UsageResponse(
        since=since,
        until=until,
        totals=Totals(**_totals(totals)),
        by_module=[ModuleUsage(**_totals(r)) for r in by_module],
        series=[
            DayPoint(
                day=str(r["day"]),
                calls=r["calls"],
                total_tokens=r["total_tokens"],
                cost_usd=_money(r.get("cost_usd")),
                unpriced_calls=r.get("unpriced_calls", 0),
            )
            for r in series
        ],
    )


@router.get("/by-seat", response_model=list[ActorUsage])
async def usage_by_seat(
    container: ContainerDep,
    tenant_id: TenantIdDep,
    _: TenantAdminDep,
    days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
) -> list[ActorUsage]:
    """Per-member consumption. Admin only -- see the module docstring."""
    since, until = _period(days)
    rows = await container.usage.by_actor(tenant_id, since=since, until=until)
    return [
        ActorUsage(
            **_totals(
                {**r, "actor_id": str(r["actor_id"]) if r.get("actor_id") else None}
            )
        )
        for r in rows
    ]
