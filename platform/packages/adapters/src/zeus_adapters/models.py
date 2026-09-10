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
