"""Plans and their limit catalog."""

from __future__ import annotations

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
