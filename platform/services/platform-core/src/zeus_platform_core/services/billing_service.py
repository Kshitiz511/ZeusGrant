"""Billing service — checkout creation and webhook application.

Checkout is scoped to a single module's price so services are bought
independently. Webhooks are normalized by the adapter into an
:class:`EntitlementChange`; here we map the Stripe price to our plan/module,
upsert the subscription, and trigger an entitlement refresh (which invalidates
and rewarms the Redis cache).

The webhook path is the point where money becomes access, so it is deliberately
strict about four things:

* **Idempotency** — Stripe delivers at least once; the event ledger makes a
  repeat delivery a no-op.
* **Ordering** — deliveries are not ordered; a stale event must not overwrite a
  newer one.
* **Resolution** — the price id identifies what was bought. If it cannot be
  mapped to a plan we refuse loudly instead of returning "not applied", because
  a customer has already been charged.
* **Never silently succeed** — an unapplied entitlement change is an incident,
  not a 200.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from zeus_adapters.interfaces import BillingProvider
from zeus_adapters.models import CheckoutSession, EntitlementChange

from zeus_platform_core.domain.models import SubscriptionStatus
from zeus_platform_core.repositories.billing import (
    BillingEventRepository,
    SubscriptionRepository,
)
from zeus_platform_core.repositories.plans import PlanRepository
from zeus_platform_core.services.entitlements_service import EntitlementsService

log = logging.getLogger(__name__)

# Event types that can change access. Everything else (invoices, payment
# intents, charges) is acknowledged and ignored so Stripe stops retrying,
# but never reaches the entitlement logic.
SUBSCRIPTION_EVENTS = frozenset(
    {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
    }
)

# Stripe subscription status -> our status (defaults to incomplete when unknown).
_STATUS_MAP = {
    "trialing": SubscriptionStatus.trialing,
    "active": SubscriptionStatus.active,
    "past_due": SubscriptionStatus.past_due,
    "unpaid": SubscriptionStatus.past_due,
    "canceled": SubscriptionStatus.canceled,
    "incomplete": SubscriptionStatus.incomplete,
    "incomplete_expired": SubscriptionStatus.canceled,
    "paused": SubscriptionStatus.past_due,
}


class UnresolvableChangeError(RuntimeError):
    """A billing event could not be mapped to a tenant, plan or module.

    Raised rather than returned because it means someone has been charged for
    something we cannot grant. It must page a human, not disappear into a 200.
    """


class BillingNotConfiguredError(RuntimeError):
    """Billing credentials are missing in this environment."""


class BillingService:
    def __init__(
        self,
        *,
        provider: BillingProvider | Callable[[], BillingProvider],
        subscriptions: SubscriptionRepository,
        plans: PlanRepository,
        entitlements: EntitlementsService,
        events: BillingEventRepository | None = None,
    ) -> None:
        # A factory may be supplied so an unconfigured Stripe does not break
        # endpoints that never touch it (the plan catalog, or a portal request
        # from a tenant that has no billing account yet).
        self._provider_factory = provider if callable(provider) else lambda: provider
        self._provider_instance: BillingProvider | None = None
        self._subscriptions = subscriptions
        self._plans = plans
        self._entitlements = entitlements
        self._events = events

    @property
    def _provider(self) -> BillingProvider:
        if self._provider_instance is None:
            try:
                self._provider_instance = self._provider_factory()
            except Exception as exc:
                raise BillingNotConfiguredError(
                    "Payments are not configured for this environment."
                ) from exc
        return self._provider_instance

    def reset_provider(self) -> None:
        """Drop the cached provider so the next call rebuilds it from settings.

        The provider is built once and held, which is right for the request
        path -- constructing a Stripe client per checkout would be waste. It is
        wrong after a credential change: the container's settings overlay picks
        up a rotated key within a minute, but this object would keep using the
        client built from the old one until the process recycled. On a warm
        serverless instance that is indefinite, so a rotation would appear to
        have silently failed.

        Called by the admin config route when a billing key is written. Note
        what it does *not* do: nothing is invalidated across other instances,
        so they still pick up the change via the settings refresh rather than
        immediately. The instance the operator is talking to is the one that
        needs to be right at once, because it is the one answering their
        'test connection'.
        """
        self._provider_instance = None

    async def test_connection(self) -> dict[str, object]:
        """Ask the provider to prove its credentials work. Creates nothing."""
        return await self._provider.test_connection()

    async def get_price(self, price_id: str) -> dict[str, object] | None:
        """Look up a price so an id can be checked before it is saved."""
        return await self._provider.get_price(price_id)

    async def create_checkout(
        self, *, tenant_id: str, price_id: str, return_url: str, trial_days: int | None = None
    ) -> CheckoutSession:
        # Only sell prices we actually know how to grant. Without this check a
        # typo'd or stale price id produces a working checkout and an
        # ungrantable subscription — a charge we cannot honour.
        if await self._plans.plan_for_price(price_id) is None:
            raise UnresolvableChangeError(
                f"Price {price_id!r} does not correspond to a known plan."
            )
        return await self._provider.create_checkout(
            tenant_id=tenant_id,
            price_id=price_id,
            return_url=return_url,
            trial_days=trial_days,
        )

    async def create_portal(self, *, tenant_id: str, return_url: str) -> str:
        customer_id = await self._subscriptions.customer_id_for_tenant(tenant_id)
        if customer_id is None:
            raise UnresolvableChangeError(
                "This workspace has no billing account yet. Subscribe to a plan first."
            )
        return await self._provider.create_portal(
            customer_id=customer_id, return_url=return_url
        )

    def parse_webhook(self, payload: bytes, signature: str) -> EntitlementChange:
        return self._provider.parse_webhook(payload, signature)

    async def handle_webhook(self, change: EntitlementChange) -> dict[str, object]:
        """Process a verified webhook exactly once.

        Returns a small result dict describing what happened, so the endpoint can
        report it and the ledger can record it.
        """
        event_type = change.raw_event_type or ""

        # Acknowledge, but do not act on, events that cannot change access.
        # Returning 200 stops Stripe retrying an event we will never use.
        if event_type not in SUBSCRIPTION_EVENTS:
            return {"applied": False, "reason": "ignored_event_type"}

        if self._events is not None and change.event_id:
            first_time = await self._events.claim(
                event_id=change.event_id,
                event_type=event_type,
                tenant_id=change.tenant_id,
            )
            if not first_time:
                log.info("Ignoring duplicate Stripe event %s", change.event_id)
                return {"applied": False, "reason": "duplicate"}

        try:
            result = await self._apply(change)
        except Exception as exc:
            if self._events is not None and change.event_id:
                await self._events.mark_applied(
                    event_id=change.event_id, applied=False, detail={"error": str(exc)}
                )
            raise

        if self._events is not None and change.event_id:
            await self._events.mark_applied(
                event_id=change.event_id,
                applied=bool(result.get("applied")),
                detail=result,
            )
        return result

    async def _apply(self, change: EntitlementChange) -> dict[str, object]:
        if change.tenant_id is None:
            raise UnresolvableChangeError(
                f"Stripe event {change.event_id} carries no tenant_id. "
                "The subscription was created outside checkout, or metadata was lost."
            )

        plan_id = change.plan_id
        module_id = change.module_id

        # The price is the only field that says *what* was bought — subscription
        # metadata carries the tenant, never the plan.
        if (plan_id is None or module_id is None) and change.price_id:
            mapping = await self._plans.plan_for_price(change.price_id)
            if mapping is not None:
                plan_id = plan_id or mapping["plan_id"]
                module_id = module_id or mapping["module_id"]

        if plan_id is None or module_id is None:
            raise UnresolvableChangeError(
                f"Could not resolve a plan for Stripe price {change.price_id!r} "
                f"(event {change.event_id}, subscription "
                f"{change.stripe_subscription_id}). The customer may have been "
                "charged without being granted access."
            )

        status = _STATUS_MAP.get(change.status or "", SubscriptionStatus.incomplete)
        # A deleted subscription arrives with its last status (often 'active'),
        # so the event type — not the status field — decides cancellation.
        if change.raw_event_type == "customer.subscription.deleted":
            status = SubscriptionStatus.canceled

        written = await self._subscriptions.upsert(
            tenant_id=change.tenant_id,
            module_id=module_id,
            plan_id=plan_id,
            status=status,
            stripe_subscription_id=change.stripe_subscription_id,
            stripe_customer_id=change.stripe_customer_id,
            stripe_price_id=change.price_id,
            event_at=change.occurred_at,
        )
        if not written:
            # A newer event already won; re-applying would move access backwards.
            log.info(
                "Ignoring out-of-order Stripe event %s for tenant %s",
                change.event_id,
                change.tenant_id,
            )
            return {"applied": False, "reason": "stale_event"}

        # Recompute the source of truth and rewarm the cache.
        await self._entitlements.refresh(change.tenant_id)
        return {
            "applied": True,
            "module_id": module_id,
            "plan_id": plan_id,
            "status": str(status),
        }

    async def apply_change(
        self, change: EntitlementChange, *, price_id: str | None = None
    ) -> bool:
        """Backwards-compatible wrapper returning only whether access changed."""
        if price_id and not change.price_id:
            change = change.model_copy(update={"price_id": price_id})
        result = await self.handle_webhook(change)
        return bool(result.get("applied"))
