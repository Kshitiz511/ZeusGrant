"""Stripe implementation of :class:`BillingProvider`.

Per-module subscriptions: each checkout is scoped to one module's price so a
customer can buy services independently. Webhooks are verified and normalized
into an :class:`EntitlementChange` the platform core applies.
"""

from __future__ import annotations

from zeus_adapters.interfaces import BillingProvider
from zeus_adapters.models import CheckoutSession, EntitlementChange


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
            "subscription_data": {"metadata": {"tenant_id": tenant_id}},
        }
        if trial_days:
            params["subscription_data"]["trial_period_days"] = trial_days
        session = self._stripe.checkout.Session.create(**params)
        return CheckoutSession(client_secret=session.client_secret, id=session.id)

    async def create_portal(self, *, customer_id: str, return_url: str) -> str:
        session = self._stripe.billing_portal.Session.create(
            customer=customer_id, return_url=return_url
        )
        return session.url

    def parse_webhook(self, payload: bytes, signature: str) -> EntitlementChange:
        event = self._stripe.Webhook.construct_event(
            payload, signature, self._webhook_secret
        )
        obj = event["data"]["object"]
        metadata = obj.get("metadata", {}) or {}
        return EntitlementChange(
            tenant_id=metadata.get("tenant_id") or obj.get("client_reference_id"),
            plan_id=metadata.get("plan_id"),
            module_id=metadata.get("module_id"),
            status=obj.get("status"),
            stripe_subscription_id=obj.get("subscription") or obj.get("id"),
            raw_event_type=event["type"],
        )
