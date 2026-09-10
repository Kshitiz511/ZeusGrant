"""Pure entitlement computation — the single source of truth."""

from zeus_platform_core.domain.entitlements import compute_claims, resolve_module_entitlement
from zeus_platform_core.domain.models import Subscription, SubscriptionStatus

CATALOG = {
    "gi_growth": {"matches_per_month": 100, "saved_opportunities_max": None},
    "cc_starter": {"contracts_max": 5},
}


def _sub(module, plan, status):
    return Subscription(tenant_id="t1", module_id=module, plan_id=plan, status=status)


def test_active_subscription_grants_module_with_limits():
    claims = compute_claims(
        "t1",
        [_sub("grant_intelligence", "gi_growth", SubscriptionStatus.active)],
        CATALOG,
    )
    assert claims.has_module("grant_intelligence")
    assert claims.limit("grant_intelligence", "matches_per_month") == 100
    assert claims.limit("grant_intelligence", "saved_opportunities_max") is None


def test_unpurchased_module_is_locked():
    claims = compute_claims(
        "t1",
        [_sub("grant_intelligence", "gi_growth", SubscriptionStatus.active)],
        CATALOG,
    )
    assert not claims.has_module("contract_compliance")
    assert not claims.has_module("audit_compliance")


def test_trialing_and_past_due_grant_access():
    for status in (SubscriptionStatus.trialing, SubscriptionStatus.past_due):
        claims = compute_claims("t1", [_sub("contract_compliance", "cc_starter", status)], CATALOG)
        assert claims.has_module("contract_compliance")


def test_canceled_does_not_grant_access():
    claims = compute_claims(
        "t1",
        [_sub("contract_compliance", "cc_starter", SubscriptionStatus.canceled)],
        CATALOG,
    )
    assert not claims.has_module("contract_compliance")


def test_active_wins_over_nongranting_duplicate():
    claims = compute_claims(
        "t1",
        [
            _sub("grant_intelligence", "gi_growth", SubscriptionStatus.canceled),
            _sub("grant_intelligence", "gi_growth", SubscriptionStatus.active),
        ],
        CATALOG,
    )
    assert claims.has_module("grant_intelligence")


def test_resolve_none_for_missing_plan_in_catalog():
    ent = resolve_module_entitlement(
        _sub("audit_compliance", "ac_unknown", SubscriptionStatus.active), CATALOG
    )
    assert ent.is_active
    assert ent.limits == {}
