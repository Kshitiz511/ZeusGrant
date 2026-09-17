"""Tenant suspension and per-tenant limit overrides.

Three claims are pinned down here, and they are the three that were decided
rather than inherited:

1. **A suspended tenant is entitled to nothing.** Not "fewer modules" -- the
   claims snapshot is empty regardless of what they have paid for. The check
   lives in ``compute_claims`` rather than at each call site so it holds
   everywhere entitlements are read, including from guards written later by
   someone who never read that file.

2. **Suspension does not stop work already in flight.** This is a product
   decision, not an accident: a customer who submitted a job while in good
   standing gets their result. The test below is therefore a *characterisation*
   test -- it exists to make the decision visible and to fail loudly if someone
   later wires an entitlement check into the worker without realising they have
   changed the policy.

3. **Override resolution is override -> plan -> unlimited**, and "no override"
   is distinct from "override set to unlimited". Collapsing those two would make
   it impossible to lift a cap without editing the plan, which is the entire
   reason the table exists.
"""

from __future__ import annotations

from datetime import UTC, datetime

from zeus_platform_core.domain.entitlements import compute_claims, resolve_module_entitlement
from zeus_platform_core.domain.models import Subscription

TENANT = "11111111-1111-1111-1111-111111111111"

CATALOG = {
    "grants_pro": {"scans_per_month": 50, "seats": 5},
    "grants_free": {"scans_per_month": 3, "seats": 1},
}


def _sub(plan_id: str = "grants_pro", status: str = "active") -> Subscription:
    return Subscription(
        id="33333333-3333-3333-3333-333333333333",
        tenant_id=TENANT,
        module_id="grants",
        plan_id=plan_id,
        status=status,
    )


# --- 1. suspension empties the snapshot -------------------------------------


def test_active_tenant_keeps_its_modules():
    claims = compute_claims(TENANT, [_sub()], CATALOG, tenant_status="active")

    assert claims.modules["grants"].is_active
    assert claims.modules["grants"].limits["scans_per_month"] == 50


def test_suspended_tenant_is_entitled_to_nothing():
    """A paid, active subscription is not enough. Suspension outranks billing."""
    claims = compute_claims(TENANT, [_sub()], CATALOG, tenant_status="suspended")

    assert claims.modules == {}
    assert claims.tenant_id == TENANT


def test_deleted_tenant_is_entitled_to_nothing():
    claims = compute_claims(TENANT, [_sub()], CATALOG, tenant_status="deleted")

    assert claims.modules == {}


def test_suspension_survives_an_override():
    """An override must not be a way to hand access back to a suspended tenant.

    The status gate runs before overrides are considered, so there is no
    combination of override rows that resurrects a suspended tenant. Worth
    pinning: the two features landed together and the interaction is not
    obvious from either one alone.
    """
    claims = compute_claims(
        TENANT,
        [_sub()],
        CATALOG,
        tenant_status="suspended",
        overrides={"scans_per_month": 9999},
    )

    assert claims.modules == {}


def test_suspension_does_not_touch_the_subscriptions():
    """Reactivating restores exactly what the tenant had.

    Suspension is an access decision, not a billing one. If it mutated
    subscriptions, reactivation would be a guess.
    """
    subs = [_sub()]
    before = [s.model_dump() for s in subs]

    compute_claims(TENANT, subs, CATALOG, tenant_status="suspended")

    assert [s.model_dump() for s in subs] == before


def test_status_defaults_to_active_for_existing_callers():
    """The default is a compatibility affordance, and it is the permissive one.

    Recorded deliberately so nobody later "fixes" a caller by omitting the
    argument and quietly grants access on an assumption.
    """
    claims = compute_claims(TENANT, [_sub()], CATALOG)

    assert claims.modules["grants"].is_active


# --- 2. work in flight is not affected --------------------------------------


def test_the_job_worker_does_not_consult_entitlements():
    """Characterisation test for the drain-on-suspend policy.

    Suspension is enforced on the request path. The worker authenticates with a
    shared secret and claims work from its own ledger, so queued jobs finish.
    If someone adds an entitlement check to the worker, this fails and forces
    the policy change to be a decision rather than a side effect.
    """
    import inspect

    from zeus_contract_compliance import jobs

    source = inspect.getsource(jobs)

    for forbidden in ("entitlements", "has_module", "require_module", "get_claims"):
        assert forbidden not in source, (
            f"the job worker now references {forbidden!r}: queued work would stop "
            "when a tenant is suspended, which reverses a deliberate policy"
        )


# --- 3. override resolution --------------------------------------------------


def test_no_override_falls_through_to_the_plan():
    ent = resolve_module_entitlement(_sub(), CATALOG, None)

    assert ent.limits["scans_per_month"] == 50


def test_override_replaces_the_plan_value():
    ent = resolve_module_entitlement(_sub(), CATALOG, {"scans_per_month": 500})

    assert ent.limits["scans_per_month"] == 500


def test_override_of_none_means_explicitly_unlimited():
    """Distinct from having no override, which would leave the plan's 50."""
    ent = resolve_module_entitlement(_sub(), CATALOG, {"scans_per_month": None})

    assert "scans_per_month" in ent.limits
    assert ent.limits["scans_per_month"] is None


def test_overriding_one_key_leaves_the_others_alone():
    """The override map is merged, not substituted.

    Substituting would silently drop every limit the plan sets but the operator
    did not happen to mention -- turning a raised ceiling into an accidental
    removal of all the others.
    """
    ent = resolve_module_entitlement(_sub(), CATALOG, {"scans_per_month": 500})

    assert ent.limits["seats"] == 5


def test_override_may_introduce_a_key_the_plan_does_not_define():
    """Grant a limit ahead of adding it to the plan.

    The route still validates the key against the union of all plans, so this
    permissiveness is bounded at the API rather than here.
    """
    ent = resolve_module_entitlement(_sub(), CATALOG, {"api_calls_per_day": 10})

    assert ent.limits["api_calls_per_day"] == 10
    assert ent.limits["scans_per_month"] == 50


def test_overrides_do_not_resurrect_a_cancelled_subscription():
    """An override tunes a limit; it is not an entitlement of its own."""
    ent = resolve_module_entitlement(
        _sub(status="canceled"), CATALOG, {"scans_per_month": 500}
    )

    assert ent.status == "none"
    assert ent.limits == {}


def test_overrides_apply_across_every_module_the_tenant_has():
    """Limit keys are global, not per module, which the resolver must reflect."""
    other = Subscription(
        id="44444444-4444-4444-4444-444444444444",
        tenant_id=TENANT,
        module_id="contracts",
        plan_id="grants_free",
        status="active",
    )

    claims = compute_claims(
        TENANT,
        [_sub(), other],
        CATALOG,
        tenant_status="active",
        overrides={"seats": 25},
        now=datetime.now(UTC),
    )

    assert claims.modules["grants"].limits["seats"] == 25
    assert claims.modules["contracts"].limits["seats"] == 25
    # ...without flattening the per-plan values it did not mention.
    assert claims.modules["grants"].limits["scans_per_month"] == 50
    assert claims.modules["contracts"].limits["scans_per_month"] == 3
