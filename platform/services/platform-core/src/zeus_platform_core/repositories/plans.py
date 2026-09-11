"""Plans and their limit catalog."""

from __future__ import annotations

import json

from zeus_adapters.interfaces import Database

from zeus_platform_core.domain.entitlements import PlanLimitCatalog


class PlanRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def limit_catalog(self) -> PlanLimitCatalog:
        """Return {plan_id: {limit_key: limit_value}} for all plans."""
        rows = await self._db.fetch(
            "SELECT plan_id, limit_key, limit_value FROM platform.plan_limits"
        )
        catalog: PlanLimitCatalog = {}
        for row in rows:
            catalog.setdefault(row["plan_id"], {})[row["limit_key"]] = row["limit_value"]
        return catalog

    async def plan_module(self, plan_id: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT module_id FROM platform.plans WHERE id = $1", plan_id
        )
        return row["module_id"] if row else None

    async def plan_for_price(self, stripe_price_id: str) -> dict | None:
        return await self._db.fetch_one(
            """
            SELECT id AS plan_id, module_id FROM platform.plans
            WHERE stripe_price_id_monthly = $1 OR stripe_price_id_annual = $1
            """,
            stripe_price_id,
        )

    async def list_purchasable(self) -> list[dict]:
        """Plans the console can offer, with their limits attached.

        Two exclusions, both deliberate:
        * inactive plans, which are retired pricing kept only for existing
          subscribers;
        * plans with no Stripe price, because offering a plan that cannot be
          bought is worse than not offering it.
        """
        rows = await self._db.fetch(
            """
            SELECT p.id AS plan_id, p.module_id, p.name,
                   p.monthly_cents, p.annual_cents,
                   p.stripe_price_id_monthly, p.stripe_price_id_annual,
                   coalesce(
                       jsonb_object_agg(l.limit_key, l.limit_value)
                           FILTER (WHERE l.limit_key IS NOT NULL),
                       '{}'::jsonb
                   ) AS limits
              FROM platform.plans p
              LEFT JOIN platform.plan_limits l ON l.plan_id = p.id
             WHERE p.is_active
               AND (p.stripe_price_id_monthly IS NOT NULL
                    OR p.stripe_price_id_annual IS NOT NULL)
             GROUP BY p.id
             ORDER BY p.module_id, coalesce(p.monthly_cents, p.annual_cents, 0)
            """
        )
        out = []
        for row in rows:
            record = dict(row)
            # asyncpg returns jsonb as a string; the router expects a mapping.
            limits = record.get("limits")
            if isinstance(limits, str):
                record["limits"] = json.loads(limits)
            out.append(record)
        return out
