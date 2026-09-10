"""Subscriptions and derived entitlements."""

from __future__ import annotations

import json

from zeus_adapters.interfaces import Database

from zeus_platform_core.domain.models import EntitlementClaims, Subscription, SubscriptionStatus


class SubscriptionRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def list_by_tenant(self, tenant_id: str, environment: str = "live") -> list[Subscription]:
        rows = await self._db.fetch(
            """
            SELECT tenant_id::text, module_id, plan_id, status,
                   stripe_subscription_id, environment, current_period_end
            FROM platform.subscriptions
            WHERE tenant_id = $1 AND environment = $2
            """,
            tenant_id,
            environment,
        )
        return [Subscription(**row) for row in rows]

    async def upsert(
        self,
        *,
        tenant_id: str,
        module_id: str,
        plan_id: str,
        status: SubscriptionStatus,
        stripe_subscription_id: str | None,
        environment: str = "live",
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.subscriptions
                (tenant_id, module_id, plan_id, status, stripe_subscription_id, environment)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (tenant_id, module_id, environment) DO UPDATE
              SET plan_id = EXCLUDED.plan_id,
                  status = EXCLUDED.status,
                  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                  updated_at = now()
            """,
            tenant_id,
            module_id,
            plan_id,
            str(status),
            stripe_subscription_id,
            environment,
        )


class EntitlementRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def save(self, claims: EntitlementClaims) -> None:
        for module_id, ent in claims.modules.items():
            await self._db.execute(
                """
                INSERT INTO platform.entitlements
                    (tenant_id, module_id, plan_id, status, limits, refreshed_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, now())
                ON CONFLICT (tenant_id, module_id) DO UPDATE
                  SET plan_id = EXCLUDED.plan_id,
                      status = EXCLUDED.status,
                      limits = EXCLUDED.limits,
                      refreshed_at = now()
                """,
                claims.tenant_id,
                module_id,
                ent.plan_id,
                ent.status,
                json.dumps(ent.limits),
            )
