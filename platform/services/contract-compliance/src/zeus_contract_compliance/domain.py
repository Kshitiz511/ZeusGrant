"""Domain models for the Contract Compliance service."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field

MODULE_ID = "contract_compliance"


class ContractStatus(StrEnum):
    draft = "draft"
    active = "active"
    archived = "archived"


class ObligationPriority(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"


class ObligationStatus(StrEnum):
    open = "open"
    in_progress = "in_progress"
    done = "done"


class Contract(BaseModel):
    id: str
    tenant_id: str
    title: str
    counterparty: str | None = None
    body: str | None = None
    status: ContractStatus = ContractStatus.draft
    created_at: datetime | None = None


class ContractCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    counterparty: str | None = None
    body: str | None = None


class Obligation(BaseModel):
    id: str
    contract_id: str
    tenant_id: str
    description: str
    due_date: date | None = None
    responsible: str | None = None
    priority: ObligationPriority = ObligationPriority.medium
    status: ObligationStatus = ObligationStatus.open
    source: str = "manual"


class ObligationDraft(BaseModel):
    """An obligation as proposed by the AI, before persistence."""

    description: str
    due_date: date | None = None
    responsible: str | None = None
    priority: ObligationPriority = ObligationPriority.medium
