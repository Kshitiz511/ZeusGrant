"""Factory selecting a :class:`BillingProvider` from settings."""

from __future__ import annotations

from zeus_config import Settings

from zeus_adapters.interfaces import BillingProvider


def build_billing_provider(settings: Settings) -> BillingProvider:
    provider = settings.billing.provider.lower()

    if provider == "stripe":
        key = settings.billing.stripe_secret_key
        webhook = settings.billing.stripe_webhook_secret
        if not key or not webhook:
            raise ValueError(
                "ZEUS_STRIPE_SECRET_KEY and ZEUS_STRIPE_WEBHOOK_SECRET are required for stripe."
            )
        from zeus_adapters.billing.stripe_billing import StripeBillingProvider

        return StripeBillingProvider(
            secret_key=key.get_secret_value(), webhook_secret=webhook.get_secret_value()
        )

    raise ValueError(f"Unknown billing provider: {provider!r}. Expected stripe.")
