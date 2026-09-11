"""Tests for the billing webhook path.

The webhook is where money becomes access, so these tests cover the failure
modes that cost real customers real money: resolving what was bought, handling
Stripe's at-least-once delivery, and refusing to move access backwards when
events arrive out of order.
"""

from __future__ import annotations

import pytest
from zeus_adapters.models import CheckoutSession, EntitlementChange
from zeus_platform_core.domain.models import SubscriptionStatus
from zeus_platform_core.services.billing_service import (
    BillingService,
    UnresolvableChangeError,
)

TENANT = "11111111-1111-1111-1111-111111111111"
PRICE = "price_cc_growth_monthly"


class StubPlans:
    def __init__(self, mapping=None):
        self.mapping = (
            mapping
            if mapping is not None
            else {PRICE: {"plan_id": "cc_growth", "module_id": "contract-compliance"}}
        )

    async def plan_for_price(self, price_id):
        return self.mapping.get(price_id)


class StubSubscriptions:
    def __init__(self, *, accept=True):
        self.upserts: list[dict] = []
        self.accept = accept
        self.customer_id: str | None = None

    async def upsert(self, **kwargs):
        self.upserts.append(kwargs)
        return self.accept

    async def customer_id_for_tenant(self, tenant_id):
        return self.customer_id


class StubEntitlements:
    def __init__(self):
        self.refreshed: list[str] = []

    async def refresh(self, tenant_id):
        self.refreshed.append(tenant_id)


class StubEvents:
    def __init__(self):
        self.seen: set[str] = set()
        self.marked: list[tuple[str, bool]] = []

    async def claim(self, *, event_id, event_type, tenant_id):
        if event_id in self.seen:
            return False
        self.seen.add(event_id)
        return True

    async def mark_applied(self, *, event_id, applied, detail=None):
        self.marked.append((event_id, applied))


class StubProvider:
    def __init__(self):
        self.checkouts: list[dict] = []
        self.portals: list[dict] = []

    async def create_checkout(self, **kwargs):
        self.checkouts.append(kwargs)
        return CheckoutSession(client_secret="cs_secret", id="cs_123")

    async def create_portal(self, **kwargs):
        self.portals.append(kwargs)
        return "https://billing.stripe.com/session/abc"

    def parse_webhook(self, payload, signature):  # pragma: no cover - unused
        raise NotImplementedError


def _service(*, plans=None, subscriptions=None, entitlements=None, events=None, provider=None):
    return BillingService(
        provider=provider or StubProvider(),
        subscriptions=subscriptions or StubSubscriptions(),
        plans=plans or StubPlans(),
        entitlements=entitlements or StubEntitlements(),
        events=events or StubEvents(),
    )


def _change(**overrides) -> EntitlementChange:
    base = {
        "tenant_id": TENANT,
        "status": "active",
        "stripe_subscription_id": "sub_123",
        "stripe_customer_id": "cus_123",
        "price_id": PRICE,
        "raw_event_type": "customer.subscription.created",
        "event_id": "evt_1",
        "occurred_at": 1_700_000_000,
    }
    base.update(overrides)
    return EntitlementChange(**base)


# --- the core regression ----------------------------------------------------


async def test_subscription_event_grants_entitlements():
    """The bug this guards: a paid subscription that granted nothing."""
    subs, ents = StubSubscriptions(), StubEntitlements()
    service = _service(subscriptions=subs, entitlements=ents)

    result = await service.handle_webhook(_change())

    assert result["applied"] is True
    assert result["module_id"] == "contract-compliance"
    assert result["plan_id"] == "cc_growth"
    assert subs.upserts[0]["status"] == SubscriptionStatus.active
    assert ents.refreshed == [TENANT]


async def test_plan_is_resolved_from_the_price_id():
    """Subscription metadata carries only tenant_id; the price says what was bought."""
    subs = StubSubscriptions()
    service = _service(subscriptions=subs)

    await service.handle_webhook(_change(plan_id=None, module_id=None))

    assert subs.upserts[0]["plan_id"] == "cc_growth"
    assert subs.upserts[0]["module_id"] == "contract-compliance"


async def test_unknown_price_raises_instead_of_silently_not_applying():
    """The customer has been charged; this must page a human, not return 200."""
    service = _service(plans=StubPlans({}))

    with pytest.raises(UnresolvableChangeError, match="Could not resolve a plan"):
        await service.handle_webhook(_change())


async def test_missing_tenant_raises():
    service = _service()

    with pytest.raises(UnresolvableChangeError, match="no tenant_id"):
        await service.handle_webhook(_change(tenant_id=None))


async def test_customer_and_price_are_persisted():
    """Without the customer id the billing portal can never be opened."""
    subs = StubSubscriptions()
    await _service(subscriptions=subs).handle_webhook(_change())

    assert subs.upserts[0]["stripe_customer_id"] == "cus_123"
    assert subs.upserts[0]["stripe_price_id"] == PRICE


# --- idempotency and ordering -----------------------------------------------


async def test_duplicate_delivery_is_a_no_op():
    """Stripe delivers at least once; the second delivery must not re-apply."""
    subs, ents, events = StubSubscriptions(), StubEntitlements(), StubEvents()
    service = _service(subscriptions=subs, entitlements=ents, events=events)

    first = await service.handle_webhook(_change())
    second = await service.handle_webhook(_change())

    assert first["applied"] is True
    assert second == {"applied": False, "reason": "duplicate"}
    assert len(subs.upserts) == 1
    assert ents.refreshed == [TENANT]


async def test_distinct_events_are_both_applied():
    subs = StubSubscriptions()
    service = _service(subscriptions=subs)

    await service.handle_webhook(_change(event_id="evt_1"))
    await service.handle_webhook(_change(event_id="evt_2", status="past_due"))

    assert len(subs.upserts) == 2
    assert subs.upserts[1]["status"] == SubscriptionStatus.past_due


async def test_stale_event_is_reported_not_applied():
    """A late 'canceled' must not revoke access granted by a newer event."""
    subs = StubSubscriptions(accept=False)  # the DB refuses the older event
    ents = StubEntitlements()
    service = _service(subscriptions=subs, entitlements=ents)

    result = await service.handle_webhook(_change(status="canceled"))

    assert result == {"applied": False, "reason": "stale_event"}
    assert ents.refreshed == []


async def test_event_ordering_timestamp_is_passed_to_the_repository():
    subs = StubSubscriptions()
    await _service(subscriptions=subs).handle_webhook(_change(occurred_at=1_700_000_500))

    assert subs.upserts[0]["event_at"] == 1_700_000_500


async def test_failure_is_recorded_in_the_ledger_and_reraised():
    events = StubEvents()
    service = _service(plans=StubPlans({}), events=events)

    with pytest.raises(UnresolvableChangeError):
        await service.handle_webhook(_change())

    assert events.marked == [("evt_1", False)]


# --- event filtering --------------------------------------------------------


@pytest.mark.parametrize(
    "event_type",
    [
        "invoice.paid",
        "payment_intent.succeeded",
        "charge.refunded",
        "customer.created",
    ],
)
async def test_irrelevant_events_are_acknowledged_without_acting(event_type):
    subs = StubSubscriptions()
    service = _service(subscriptions=subs)

    result = await service.handle_webhook(_change(raw_event_type=event_type))

    assert result == {"applied": False, "reason": "ignored_event_type"}
    assert subs.upserts == []


async def test_deleted_event_cancels_even_when_status_still_says_active():
    """Stripe sends the subscription's last status on deletion, often 'active'."""
    subs = StubSubscriptions()
    service = _service(subscriptions=subs)

    await service.handle_webhook(
        _change(raw_event_type="customer.subscription.deleted", status="active")
    )

    assert subs.upserts[0]["status"] == SubscriptionStatus.canceled


async def test_unknown_status_falls_back_to_incomplete():
    subs = StubSubscriptions()
    await _service(subscriptions=subs).handle_webhook(_change(status="something_new"))

    assert subs.upserts[0]["status"] == SubscriptionStatus.incomplete


# --- checkout and portal ----------------------------------------------------


async def test_checkout_rejects_a_price_we_cannot_grant():
    """Better to fail the checkout than to take money for an ungrantable plan."""
    service = _service(plans=StubPlans({}))

    with pytest.raises(UnresolvableChangeError, match="does not correspond"):
        await service.create_checkout(
            tenant_id=TENANT, price_id="price_typo", return_url="https://app/return"
        )


async def test_checkout_passes_the_tenant_through():
    provider = StubProvider()
    service = _service(provider=provider)

    session = await service.create_checkout(
        tenant_id=TENANT, price_id=PRICE, return_url="https://app/return", trial_days=14
    )

    assert session.client_secret == "cs_secret"
    assert provider.checkouts[0]["tenant_id"] == TENANT
    assert provider.checkouts[0]["trial_days"] == 14


async def test_portal_requires_an_existing_customer():
    service = _service(subscriptions=StubSubscriptions())

    with pytest.raises(UnresolvableChangeError, match="no billing account"):
        await service.create_portal(tenant_id=TENANT, return_url="https://app/return")


async def test_portal_uses_the_stored_customer_id():
    subs = StubSubscriptions()
    subs.customer_id = "cus_123"
    provider = StubProvider()

    url = await _service(subscriptions=subs, provider=provider).create_portal(
        tenant_id=TENANT, return_url="https://app/return"
    )

    assert url.startswith("https://billing.stripe.com/")
    assert provider.portals[0]["customer_id"] == "cus_123"


async def test_apply_change_wrapper_still_works():
    """Legacy call site passing price_id separately must keep working."""
    subs = StubSubscriptions()
    service = _service(subscriptions=subs)

    applied = await service.apply_change(_change(price_id=None), price_id=PRICE)

    assert applied is True
    assert subs.upserts[0]["plan_id"] == "cc_growth"
