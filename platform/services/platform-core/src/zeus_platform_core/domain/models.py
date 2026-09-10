"""Domain models for platform core.

Provider-agnostic pydantic models shared across the domain, repositories and
routers. Kept separate from adapter models so the domain owns its vocabulary.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Role(StrEnum):
    owner = "owner"
    admin = "admin"
    member = "member"
    viewer = "viewer"


class SubscriptionStatus(StrEnum):
    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
    incomplete = "incomplete"


# Statuses that grant access. past_due keeps access during dunning; the billing
# system chases payment before flipping to canceled.
ACCESS_GRANTING_STATUSES: frozenset[str] = frozenset(
    {SubscriptionStatus.trialing, SubscriptionStatus.active, SubscriptionStatus.past_due}
)


class Tenant(BaseModel):
    id: str
    name: str
    slug: str
    owner_user_id: str
    status: str = "active"
    stripe_customer_id: str | None = None


class Subscription(BaseModel):
    tenant_id: str
    module_id: str
    plan_id: str
    status: SubscriptionStatus
    stripe_subscription_id: str | None = None
    environment: str = "live"
    current_period_end: datetime | None = None


class ModuleEntitlement(BaseModel):
    """A tenant's resolved access to one module."""

    module_id: str
    plan_id: str | None = None
    status: str = "none"
    limits: dict[str, int | None] = Field(default_factory=dict)

    @property
    def is_active(self) -> bool:
        return self.status in ACCESS_GRANTING_STATUSES


class EntitlementClaims(BaseModel):
    """The full access snapshot for a tenant — the single source of truth
    the guard consults. Cached in Redis and embeddable in a session token."""

    tenant_id: str
    modules: dict[str, ModuleEntitlement] = Field(default_factory=dict)
    generated_at: datetime | None = None

    def has_module(self, module_id: str) -> bool:
        ent = self.modules.get(module_id)
        return ent is not None and ent.is_active

    def limit(self, module_id: str, key: str) -> int | None:
        ent = self.modules.get(module_id)
        if ent is None:
            return None
        return ent.limits.get(key)
