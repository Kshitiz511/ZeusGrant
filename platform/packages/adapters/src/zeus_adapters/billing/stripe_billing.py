"""Stripe implementation of :class:`BillingProvider`.

Per-module subscriptions: each checkout is scoped to one module's price so a
customer can buy services independently. Webhooks are verified and normalized
into an :class:`EntitlementChange` the platform core applies.

Two things this adapter is careful about:

* **The price id is extracted from the subscription's line items.** Stripe
  subscription metadata carries only ``tenant_id``; the price is the only field
  that says *which product* was bought. Losing it means the customer is charged
  and granted nothing.

* **The Stripe SDK is synchronous.** Calling it directly from an ``async def``
  blocks the event loop for the duration of a network round trip, stalling every
  other request on the worker. All SDK calls therefore run in a thread.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from zeus_adapters.interfaces import BillingProvider
from zeus_adapters.models import CheckoutSession, EntitlementChange

log = logging.getLogger(__name__)

# Events that can change entitlements. Anything else is acknowledged and ignored
# so Stripe stops retrying, but never reaches the entitlement logic.
SUBSCRIPTION_EVENTS = frozenset(
    {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "customer.subscription.paused",
        "customer.subscription.resumed",
    }
)


class StripeBillingProvider(BillingProvider):
    def __init__(self, *, secret_key: str, webhook_secret: str) -> None:
        try:
            import stripe
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Stripe billing selected but not installed. Install with "
                "`uv pip install 'zeus-adapters[stripe]'`."
            ) from exc
        self._stripe = stripe
        self._stripe.api_key = secret_key
        self._webhook_secret = webhook_secret

    async def create_checkout(
        self, *, tenant_id: str, price_id: str, return_url: str, trial_days: int | None = None
    ) -> CheckoutSession:
        params: dict = {
            "mode": "subscription",
            "ui_mode": "embedded",
            "line_items": [{"price": price_id, "quantity": 1}],
            "return_url": return_url,
            "client_reference_id": tenant_id,
            "metadata": {"tenant_id": tenant_id},
            # Propagated onto the subscription so every later webhook — which
            # never sees the checkout session — can still identify the tenant.
            "subscription_data": {"metadata": {"tenant_id": tenant_id}},
        }
        if trial_days:
            params["subscription_data"]["trial_period_days"] = trial_days

        session = await asyncio.to_thread(
            lambda: self._stripe.checkout.Session.create(**params)
        )
        return CheckoutSession(client_secret=session.client_secret, id=session.id)

    async def create_portal(self, *, customer_id: str, return_url: str) -> str:
        session = await asyncio.to_thread(
            lambda: self._stripe.billing_portal.Session.create(
                customer=customer_id, return_url=return_url
            )
        )
        return session.url

    def parse_webhook(self, payload: bytes, signature: str) -> EntitlementChange:
        """Verify the signature and normalize the event.

        Purely local: signature verification is an HMAC check and every field we
        need is already inside the payload, so this makes no network call.
        """
        event = self._stripe.Webhook.construct_event(payload, signature, self._webhook_secret)
        obj = event["data"]["object"]
        metadata = obj.get("metadata") or {}

        return EntitlementChange(
            tenant_id=metadata.get("tenant_id") or obj.get("client_reference_id"),
            plan_id=metadata.get("plan_id"),
            module_id=metadata.get("module_id"),
            status=obj.get("status"),
            stripe_subscription_id=obj.get("subscription") or obj.get("id"),
            stripe_customer_id=_customer_id(obj),
            price_id=_price_id(obj),
            raw_event_type=event["type"],
            event_id=event.get("id"),
            occurred_at=event.get("created"),
        )


def _customer_id(obj: Any) -> str | None:
    """Customer may be an id string or an expanded object."""
    customer = obj.get("customer")
    if isinstance(customer, str):
        return customer
    if isinstance(customer, dict):
        return customer.get("id")
    return None


def _price_id(obj: Any) -> str | None:
    """Pull the price id out of a subscription's line items.

    A subscription carries ``items.data[*].price.id``. We sell one module per
    subscription, so the first item is the one that matters; if a subscription
    somehow has several we still take the first, but say so in the log rather
    than silently guessing.
    """
    items = obj.get("items")
    data = items.get("data") if isinstance(items, dict) else None
    if not data:
        # Some event shapes (checkout.session.*) carry no inline items. Those
        # are not used to grant entitlements — the customer.subscription.*
        # event that always follows carries the full subscription.
        price = obj.get("price")
        return price.get("id") if isinstance(price, dict) else None

    if len(data) > 1:
        log.warning(
            "Subscription %s has %d line items; using the first for plan resolution.",
            obj.get("id"),
            len(data),
        )
    price = data[0].get("price")
    if isinstance(price, str):
        return price
    if isinstance(price, dict):
        return price.get("id")
    return None
