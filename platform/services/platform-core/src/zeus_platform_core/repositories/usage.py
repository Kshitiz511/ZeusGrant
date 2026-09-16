"""Read side of the AI usage ledger.

``platform.ai_usage`` has been written to since migration 0006 and read by
nothing. This module is the read path: what a workspace consumed, by whom, on
which module, over time.

Three rules run through every query here.

**An unknown cost stays unknown.** ``cost_usd`` is NULL when the model had no
configured price or the provider reported no usage. ``sum()`` skips NULLs
silently, which would quietly report a partial total as if it were complete.
Every cost rollup therefore also returns how many rows were unpriced, so a
caller can tell "$4.10" from "$4.10 plus an unknown amount". Presenting the
second as the first is how a runaway bill stays hidden.

**Platform-wide rows are not a tenant's.** Rows with ``tenant_id IS NULL`` are
shared-catalogue work attributable to no customer (see migration 0015). Every
tenant query filters on an explicit tenant id, so they are excluded by
construction rather than by remembering to exclude them.

**Periods are half-open.** ``[since, until)``. A closed interval double-counts
any row landing exactly on a boundary when two adjacent periods are summed,
which is the sort of error that shows up as a penny of drift and takes a day
to find.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from zeus_adapters.interfaces import Database

#: Selected by every rollup. Kept in one place so the "unpriced" counter can
#: never drift out of step with the sum it qualifies.
_TOTALS = """
    count(*)                                        AS calls,
    count(*) FILTER (WHERE NOT succeeded)           AS failures,
    coalesce(sum(prompt_tokens), 0)                 AS prompt_tokens,
    coalesce(sum(completion_tokens), 0)             AS completion_tokens,
    coalesce(sum(total_tokens), 0)                  AS total_tokens,
    sum(cost_usd)                                   AS cost_usd,
    count(*) FILTER (WHERE cost_usd IS NULL)        AS unpriced_calls
"""


def _row(row: Any) -> dict[str, Any]:
    """Normalise one aggregate row.

    ``cost_usd`` is deliberately left as ``None`` when nothing was priced.
    Coercing it to ``Decimal("0")`` here would be the exact lie this module
    exists to avoid -- a workspace that ran a hundred unpriced calls would
    report a confident $0.00.
    """
    d = dict(row)
    cost = d.get("cost_usd")
    d["cost_usd"] = Decimal(str(cost)) if cost is not None else None
    return d


class UsageRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def tenant_totals(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> dict[str, Any]:
        """Everything one workspace consumed in a period."""
        row = await self._db.fetch_one(
            f"""
            SELECT {_TOTALS}
              FROM platform.ai_usage
             WHERE tenant_id = $1::uuid
               AND created_at >= $2
               AND created_at <  $3
            """,
            tenant_id,
            since,
            until,
        )
        return _row(row) if row else _row({})

    async def by_actor(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> list[dict[str, Any]]:
        """Per-seat attribution -- "who in my team spent what".

        Joins to users so the caller gets an email rather than a UUID. A LEFT
        join because ``actor_id`` is nullable: work run by a background job on
        the tenant's behalf has no human actor, and dropping those rows would
        make the per-seat table disagree with the total above it.
        """
        rows = await self._db.fetch(
            f"""
            SELECT u.actor_id,
                   usr.email,
                   usr.full_name,
                   {_TOTALS}
              FROM platform.ai_usage u
              LEFT JOIN platform.users usr ON usr.id = u.actor_id
             WHERE u.tenant_id = $1::uuid
               AND u.created_at >= $2
               AND u.created_at <  $3
             GROUP BY u.actor_id, usr.email, usr.full_name
             ORDER BY sum(u.cost_usd) DESC NULLS LAST, count(*) DESC
            """,
            tenant_id,
            since,
            until,
        )
        return [_row(r) for r in rows]

    async def by_module(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> list[dict[str, Any]]:
        rows = await self._db.fetch(
            f"""
            SELECT module_id, {_TOTALS}
              FROM platform.ai_usage
             WHERE tenant_id = $1::uuid
               AND created_at >= $2
               AND created_at <  $3
             GROUP BY module_id
             ORDER BY sum(cost_usd) DESC NULLS LAST, count(*) DESC
            """,
            tenant_id,
            since,
            until,
        )
        return [_row(r) for r in rows]

    async def daily_series(
        self, tenant_id: str, *, since: datetime, until: datetime
    ) -> list[dict[str, Any]]:
        """Daily totals, with empty days present as zeroes.

        ``generate_series`` rather than a plain GROUP BY: a chart built from
        only the days that have rows draws a continuous line across a gap,
        which reads as steady usage when in fact nothing happened.
        """
        rows = await self._db.fetch(
            """
            SELECT d::date                                   AS day,
                   coalesce(count(u.id), 0)                  AS calls,
                   coalesce(sum(u.total_tokens), 0)          AS total_tokens,
                   sum(u.cost_usd)                           AS cost_usd,
                   count(*) FILTER (WHERE u.id IS NOT NULL
                                      AND u.cost_usd IS NULL) AS unpriced_calls
              FROM generate_series($2::date, $3::date - interval '1 day', interval '1 day') d
              LEFT JOIN platform.ai_usage u
                     ON u.tenant_id = $1::uuid
                    AND u.created_at >= d
                    AND u.created_at <  d + interval '1 day'
             GROUP BY d
             ORDER BY d
            """,
            tenant_id,
            since,
            until,
        )
        return [_row(r) for r in rows]

    # --- cross-tenant. Owner only; no route reaches these before Phase 4. ---

    async def platform_totals(self, *, since: datetime, until: datetime) -> dict[str, Any]:
        """Spend across every tenant, including unattributable platform work.

        No tenant filter at all, which is the point: this is the only view in
        which the shared-catalogue rows mean anything.
        """
        row = await self._db.fetch_one(
            f"""
            SELECT {_TOTALS},
                   count(*) FILTER (WHERE tenant_id IS NULL)  AS platform_calls,
                   sum(cost_usd) FILTER (WHERE tenant_id IS NULL) AS platform_cost_usd
              FROM platform.ai_usage
             WHERE created_at >= $1
               AND created_at <  $2
            """,
            since,
            until,
        )
        return _row(row) if row else _row({})

    async def top_tenants_by_cost(
        self, *, since: datetime, until: datetime, limit: int = 20
    ) -> list[dict[str, Any]]:
        rows = await self._db.fetch(
            f"""
            SELECT u.tenant_id, t.name AS tenant_name, {_TOTALS}
              FROM platform.ai_usage u
              LEFT JOIN platform.tenants t ON t.id = u.tenant_id
             WHERE u.created_at >= $1
               AND u.created_at <  $2
               AND u.tenant_id IS NOT NULL
             GROUP BY u.tenant_id, t.name
             ORDER BY sum(u.cost_usd) DESC NULLS LAST, count(*) DESC
             LIMIT $3
            """,
            since,
            until,
            limit,
        )
        return [_row(r) for r in rows]

    async def unpriced_models(self, *, since: datetime, until: datetime) -> list[dict[str, Any]]:
        """Models being used that have no price configured.

        This is the operational counterpart to returning NULL honestly: the
        owner needs to know *which* model is making the total incomplete, so
        it can be priced in the admin panel.
        """
        rows = await self._db.fetch(
            """
            SELECT model, count(*) AS calls, coalesce(sum(total_tokens), 0) AS total_tokens
              FROM platform.ai_usage
             WHERE created_at >= $1
               AND created_at <  $2
               AND cost_usd IS NULL
             GROUP BY model
             ORDER BY count(*) DESC
            """,
            since,
            until,
        )
        return [dict(r) for r in rows]
