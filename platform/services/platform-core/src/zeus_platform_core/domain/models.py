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


#: The platform-wide operator privilege, carried in a token's ``roles`` claim.
#:
#: Deliberately not a member of ``Role`` above: that enum describes a person's
#: standing *within one workspace*, and this is orthogonal to any workspace.
#: Folding it in would make "owner or platform_admin" look like a choice
#: between two comparable things, and would let it be stored in
#: ``platform.memberships.role`` where it has no meaning.
#:
#: It lives here, in the domain layer, rather than in ``security`` so that
#: token-minting services can name it without importing the FastAPI dependency
#: module -- which imports the container, which imports those same services.
PLATFORM_ADMIN_ROLE = "platform_admin"


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

    def limit_ceiling(self, module_id: str, key: str, *, fallback: int) -> int | None:
        """Resolve a numeric limit into the three answers a caller can act on.

        ``None`` means unlimited. An integer is a ceiling. ``fallback`` is used
        only when the tenant has no active entitlement for the module at all.

        This exists because ``limit()`` returns ``None`` for two situations that
        are opposites, and a caller reading it directly has no way to tell them
        apart:

        * the plan states the key with a NULL value, or omits it, which under
          DEC-10 means **unlimited**;
        * the tenant has no entitlement for this module, which means they
          should not be here at all.

        Collapsing those is not academic. Every ``*_enterprise`` plan ships with
        **zero** limit rows, precisely because DEC-10 makes that mean unlimited.
        A caller that reads a missing row as "be safe, use the free-tier
        default" hands the most expensive plan on the price list the smallest
        allowance on it -- see defect D22.

        The fallback is kept for the entitlement-missing case rather than
        raising, because a limit check is not the right place to discover an
        authorisation problem; the route's entitlement guard is. If that guard
        is ever bypassed, the free-tier number is the safe thing to be left
        holding.
        """
        ent = self.modules.get(module_id)
        if ent is None or not ent.is_active:
            return fallback
        return ent.limits.get(key)
