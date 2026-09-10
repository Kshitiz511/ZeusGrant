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


def resolve_module_entitlement(
    subscription: Subscription | None, catalog: PlanLimitCatalog
) -> ModuleEntitlement:
    """Resolve one module's entitlement from its (optional) subscription."""
    if subscription is None or subscription.status not in ACCESS_GRANTING_STATUSES:
        module_id = subscription.module_id if subscription else ""
        return ModuleEntitlement(module_id=module_id, status="none", limits={})

    return ModuleEntitlement(
        module_id=subscription.module_id,
        plan_id=subscription.plan_id,
        status=str(subscription.status),
        limits=dict(catalog.get(subscription.plan_id, {})),
    )


def compute_claims(
    tenant_id: str,
    subscriptions: list[Subscription],
    catalog: PlanLimitCatalog,
    *,
    now: datetime | None = None,
) -> EntitlementClaims:
    """Fold a tenant's subscriptions into a complete access snapshot.

    When multiple subscriptions exist for the same module (should not happen
    given the DB unique constraint, but defensively handled), an access-granting
    one wins over a non-granting one.
    """
    modules: dict[str, ModuleEntitlement] = {}
    for sub in subscriptions:
        resolved = resolve_module_entitlement(sub, catalog)
        existing = modules.get(sub.module_id)
        if existing is None or (resolved.is_active and not existing.is_active):
            modules[sub.module_id] = resolved

    return EntitlementClaims(
        tenant_id=tenant_id,
        modules=modules,
        generated_at=now or datetime.now(UTC),
    )
