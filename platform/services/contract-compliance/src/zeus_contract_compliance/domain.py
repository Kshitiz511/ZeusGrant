"""Domain models for the Contract Compliance service."""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any

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


class BodySource(StrEnum):
    manual = "manual"
    document = "document"


class Contract(BaseModel):
    id: str
    tenant_id: str
    title: str
    counterparty: str | None = None
    body: str | None = None
    status: ContractStatus = ContractStatus.draft
    body_source: BodySource = BodySource.manual
    last_analyzed_at: datetime | None = None
    created_at: datetime | None = None


class ContractCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    counterparty: str | None = Field(default=None, max_length=300)
    body: str | None = None


class ContractUpdate(BaseModel):
    """Partial update. Unset fields are left untouched.

    ``model_fields_set`` distinguishes "not provided" from "explicitly null",
    so a caller can clear ``counterparty`` without clearing ``body``.
    """

    title: str | None = Field(default=None, min_length=1, max_length=300)
    counterparty: str | None = Field(default=None, max_length=300)
    body: str | None = None
    status: ContractStatus | None = None


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


class ObligationCreate(BaseModel):
    """A manually authored obligation."""

    description: str = Field(min_length=1, max_length=2000)
    due_date: date | None = None
    responsible: str | None = Field(default=None, max_length=200)
    priority: ObligationPriority = ObligationPriority.medium
    status: ObligationStatus = ObligationStatus.open


class ObligationUpdate(BaseModel):
    """Partial update for the obligation workflow (status, owner, dates)."""

    description: str | None = Field(default=None, min_length=1, max_length=2000)
    due_date: date | None = None
    responsible: str | None = Field(default=None, max_length=200)
    priority: ObligationPriority | None = None
    status: ObligationStatus | None = None


class ObligationWithContract(Obligation):
    """Obligation enriched for the tenant-wide task feed."""

    contract_title: str


class Document(BaseModel):
    """Metadata for an uploaded source file. Bytes live in object storage."""

    id: str
    tenant_id: str
    contract_id: str
    filename: str
    content_type: str
    byte_size: int
    checksum: str
    extracted_chars: int = 0
    created_at: datetime | None = None


class AuditEntry(BaseModel):
    """One append-only record of a mutating action."""

    id: int
    tenant_id: str
    actor_id: str | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None
