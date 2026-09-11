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
        stripe_customer_id: str | None = None,
        stripe_price_id: str | None = None,
        event_at: int | None = None,
        environment: str = "live",
    ) -> bool:
        """Insert or update the subscription. Returns False if the event was stale.

        Ordering is enforced in SQL rather than in Python because two webhook
        deliveries can be in flight at once; the WHERE clause on the DO UPDATE
        makes "only apply if newer" atomic under concurrency.

        A NULL ``last_event_at`` (rows written before this column existed, or by
        an admin) is treated as older than any event, so it is safe to overwrite.
        """
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.subscriptions
                (tenant_id, module_id, plan_id, status, stripe_subscription_id,
                 stripe_customer_id, stripe_price_id, last_event_at, environment)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (tenant_id, module_id, environment) DO UPDATE
              SET plan_id = EXCLUDED.plan_id,
                  status = EXCLUDED.status,
                  stripe_subscription_id = EXCLUDED.stripe_subscription_id,
                  -- Keep the existing customer id if this event omitted one;
                  -- losing it would break the billing portal.
                  stripe_customer_id = coalesce(
                      EXCLUDED.stripe_customer_id, platform.subscriptions.stripe_customer_id),
                  stripe_price_id = coalesce(
                      EXCLUDED.stripe_price_id, platform.subscriptions.stripe_price_id),
                  last_event_at = EXCLUDED.last_event_at,
                  updated_at = now()
            WHERE EXCLUDED.last_event_at IS NULL
               OR platform.subscriptions.last_event_at IS NULL
               OR EXCLUDED.last_event_at >= platform.subscriptions.last_event_at
            RETURNING id
            """,
            tenant_id,
            module_id,
            plan_id,
            str(status),
            stripe_subscription_id,
            stripe_customer_id,
            stripe_price_id,
            event_at,
            environment,
        )
        return row is not None

    async def customer_id_for_tenant(self, tenant_id: str) -> str | None:
        """Any Stripe customer id on record for the tenant.

        A tenant has one Stripe customer even with several module
        subscriptions, so the most recently updated row is authoritative.
        """
        row = await self._db.fetch_one(
            """
            SELECT stripe_customer_id
              FROM platform.subscriptions
             WHERE tenant_id = $1 AND stripe_customer_id IS NOT NULL
             ORDER BY updated_at DESC
             LIMIT 1
            """,
            tenant_id,
        )
        return row["stripe_customer_id"] if row else None


class BillingEventRepository:
    """Ledger of processed Stripe events, making webhook handling idempotent.

    Stripe guarantees at-least-once delivery, so the same event will arrive
    twice. ``claim`` inserts the id and reports whether this caller is the first
    to see it; duplicates are acknowledged without re-applying the change.
    """

    def __init__(self, db: Database) -> None:
        self._db = db

    async def claim(
        self, *, event_id: str, event_type: str, tenant_id: str | None
    ) -> bool:
        """Return True if this event is new and should be processed.

        The INSERT ... ON CONFLICT DO NOTHING is atomic, so two concurrent
        deliveries of the same event cannot both win.
        """
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.billing_events (event_id, event_type, tenant_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id) DO NOTHING
            RETURNING event_id
            """,
            event_id,
            event_type,
            tenant_id,
        )
        return row is not None

    async def mark_applied(
        self, *, event_id: str, applied: bool, detail: dict | None = None
    ) -> None:
        await self._db.execute(
            """
            UPDATE platform.billing_events
               SET applied = $2, detail = $3::jsonb
             WHERE event_id = $1
            """,
            event_id,
            applied,
            json.dumps(detail or {}, default=str),
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
