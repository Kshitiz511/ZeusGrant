"""Billing service — checkout creation and webhook application.

Checkout is scoped to a single module's price so services are bought
independently. Webhooks are normalized by the adapter into an
:class:`EntitlementChange`; here we map the Stripe price to our plan/module,
upsert the subscription, and trigger an entitlement refresh (which invalidates
and rewarms the Redis cache).
"""

from __future__ import annotations

from zeus_adapters.interfaces import BillingProvider
from zeus_adapters.models import CheckoutSession, EntitlementChange

from zeus_platform_core.domain.models import SubscriptionStatus
from zeus_platform_core.repositories.billing import SubscriptionRepository
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.services.entitlements_service import EntitlementsService

# Stripe subscription status -> our status (defaults to incomplete when unknown).
_STATUS_MAP = {
    "trialing": SubscriptionStatus.trialing,
    "active": SubscriptionStatus.active,
    "past_due": SubscriptionStatus.past_due,
    "unpaid": SubscriptionStatus.past_due,
    "canceled": SubscriptionStatus.canceled,
    "incomplete": SubscriptionStatus.incomplete,
    "incomplete_expired": SubscriptionStatus.canceled,
}


class BillingService:
    def __init__(
        self,
        *,
        provider: BillingProvider,
        subscriptions: SubscriptionRepository,
        plans: PlanRepository,
        entitlements: EntitlementsService,
    ) -> None:
        self._provider = provider
        self._subscriptions = subscriptions
        self._plans = plans
        self._entitlements = entitlements

    async def create_checkout(
        self, *, tenant_id: str, price_id: str, return_url: str, trial_days: int | None = None
    ) -> CheckoutSession:
        return await self._provider.create_checkout(
            tenant_id=tenant_id,
            price_id=price_id,
            return_url=return_url,
            trial_days=trial_days,
        )

    def parse_webhook(self, payload: bytes, signature: str) -> EntitlementChange:
        return self._provider.parse_webhook(payload, signature)

    async def apply_change(self, change: EntitlementChange, *, price_id: str | None = None) -> bool:
        """Apply a normalized billing change. Returns True if a subscription
        was written (i.e. we could resolve tenant + plan)."""
        if change.tenant_id is None:
            return False

        plan_id = change.plan_id
        module_id = change.module_id
        if (plan_id is None or module_id is None) and price_id is not None:
            mapping = await self._plans.plan_for_price(price_id)
            if mapping is not None:
                plan_id = plan_id or mapping["plan_id"]
                module_id = module_id or mapping["module_id"]

        if plan_id is None or module_id is None:
            return False

        status = _STATUS_MAP.get(change.status or "", SubscriptionStatus.incomplete)
        await self._subscriptions.upsert(
            tenant_id=change.tenant_id,
            module_id=module_id,
            plan_id=plan_id,
            status=status,
            stripe_subscription_id=change.stripe_subscription_id,
        )
        # Recompute the source of truth and rewarm the cache.
        await self._entitlements.refresh(change.tenant_id)
        return True
