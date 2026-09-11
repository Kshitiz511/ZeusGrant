"""Shared data models used across adapter interfaces.

Kept dependency-free (pydantic only) so every adapter speaks the same
vocabulary regardless of the concrete provider behind it.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Role(StrEnum):
    system = "system"
    user = "user"
    assistant = "assistant"


class Message(BaseModel):
    role: Role
    content: str


class Completion(BaseModel):
    text: str
    model: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    raw: dict | None = None


class Session(BaseModel):
    """A verified auth session, provider-agnostic."""

    user_id: str
    email: str | None = None
    tenant_id: str | None = None
    roles: list[str] = Field(default_factory=list)
    claims: dict = Field(default_factory=dict)


class CheckoutSession(BaseModel):
    client_secret: str | None = None
    url: str | None = None
    id: str | None = None


class EntitlementChange(BaseModel):
    """Normalized result of a billing webhook."""

    tenant_id: str | None = None
    module_id: str | None = None
    plan_id: str | None = None
    status: str | None = None
    stripe_subscription_id: str | None = None
    raw_event_type: str | None = None

    # The purchased price. Stripe subscription metadata only carries tenant_id,
    # so this is the only thing that identifies *what* was bought — without it
    # the plan/module cannot be resolved and the customer pays for nothing.
    price_id: str | None = None
    # Needed for the billing portal, which is addressed by customer, not
    # subscription.
    stripe_customer_id: str | None = None
    # Event identity and ordering. `event_id` makes webhook handling idempotent
    # under Stripe's at-least-once delivery; `occurred_at` lets us ignore an
    # event that arrives after a newer one has already been applied.
    event_id: str | None = None
    occurred_at: int | None = None
