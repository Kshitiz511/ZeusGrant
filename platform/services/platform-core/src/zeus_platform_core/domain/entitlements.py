"""Entitlement computation — the single source of truth.

Pure functions: given a tenant's subscriptions and the plan-limit catalog,
produce :class:`EntitlementClaims`. No I/O here, so this is exhaustively
unit-testable and identical everywhere it runs (gateway, services, worker).

This deliberately replaces the legacy three-way duplication (client mirror +
SQL functions + ad-hoc server checks) that made the old app fragile.
"""

from __future__ import annotations

from datetime import UTC, datetime

from zeus_platform_core.domain.models import (
    ACCESS_GRANTING_STATUSES,
    EntitlementClaims,
    ModuleEntitlement,
    Subscription,
)

# plan_id -> {limit_key -> limit_value (None = unlimited)}
PlanLimitCatalog = dict[str, dict[str, int | None]]

#: limit_key -> limit_value (None = explicitly unlimited). Applied on top of the
#: plan's limits for one tenant. An absent key falls through to the plan; a key
#: present with None is an explicit lifting of the cap. Those are different
#: things and the resolver keeps them distinct.
LimitOverrides = dict[str, int | None]

#: Tenant statuses that permit access. Anything else -- suspended, deleted --
#: grants nothing, regardless of what the tenant has paid for.
ACTIVE_TENANT_STATUSES = frozenset({"active"})


def resolve_module_entitlement(
    subscription: Subscription | None,
    catalog: PlanLimitCatalog,
    overrides: LimitOverrides | None = None,
) -> ModuleEntitlement:
    """Resolve one module's entitlement from its (optional) subscription."""
    if subscription is None or subscription.status not in ACCESS_GRANTING_STATUSES:
        module_id = subscription.module_id if subscription else ""
        return ModuleEntitlement(module_id=module_id, status="none", limits={})

    limits = dict(catalog.get(subscription.plan_id, {}))
    if overrides:
        # Overrides are applied per key rather than replacing the whole map, so
        # raising one ceiling does not silently drop every other limit the plan
        # sets. A key the plan never defined is still allowed through: that is
        # how a limit can be granted to one tenant ahead of being added to a
        # plan.
        limits.update(overrides)

    return ModuleEntitlement(
        module_id=subscription.module_id,
        plan_id=subscription.plan_id,
        status=str(subscription.status),
        limits=limits,
    )


def compute_claims(
    tenant_id: str,
    subscriptions: list[Subscription],
    catalog: PlanLimitCatalog,
    *,
    now: datetime | None = None,
    tenant_status: str = "active",
    overrides: LimitOverrides | None = None,
) -> EntitlementClaims:
    """Fold a tenant's subscriptions into a complete access snapshot.

    When multiple subscriptions exist for the same module (should not happen
    given the DB unique constraint, but defensively handled), an access-granting
    one wins over a non-granting one.

    **A suspended tenant gets an empty snapshot.** Enforcing it here rather than
    at each call site means suspension holds everywhere entitlements are read,
    including any guard written later by someone who never read this file. The
    subscriptions are left untouched: suspension is an access decision, not a
    billing one, and reactivating must restore exactly what they had.

    Note what this does *not* stop. Work already in the job ledger keeps
    running, because the worker authenticates by shared secret and never
    consults entitlements. That is deliberate -- suspension blocks new work
    without destroying work the customer legitimately submitted while active.

    ``tenant_status`` defaults to active so existing callers keep their
    behaviour. That default is a compatibility affordance and not an invitation:
    a caller that cannot supply the real status is granting access on an
    assumption.
    """
    if tenant_status not in ACTIVE_TENANT_STATUSES:
        return EntitlementClaims(
            tenant_id=tenant_id,
            modules={},
            generated_at=now or datetime.now(UTC),
        )

    modules: dict[str, ModuleEntitlement] = {}
    for sub in subscriptions:
        resolved = resolve_module_entitlement(sub, catalog, overrides)
        existing = modules.get(sub.module_id)
        if existing is None or (resolved.is_active and not existing.is_active):
            modules[sub.module_id] = resolved

    return EntitlementClaims(
        tenant_id=tenant_id,
        modules=modules,
        generated_at=now or datetime.now(UTC),
    )
