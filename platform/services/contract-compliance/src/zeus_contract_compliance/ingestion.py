"""Document ingestion: validate → store bytes → extract text → record.

Kept out of the router so the ordering guarantees are explicit and testable:

1. **Validate first.** Size cap and format sniffing happen before anything is
   written, so a rejected upload leaves no trace in storage or the database.
2. **Storage before database.** The row is only written once the bytes are
   durably stored, so metadata never points at a missing object.
3. **Compensate on failure.** If the database insert fails after the object is
   written, the object is deleted, leaving no orphaned bytes.

Storage keys are fully derived server-side —
``{tenant_id}/{contract_id}/{checksum}-{safe_name}`` — so a user-supplied
filename can never influence the path.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from zeus_adapters.interfaces import Storage

from zeus_contract_compliance.documents import (
    ExtractedDocument,
    UnsupportedDocumentError,
    extract_document,
    safe_filename,
)
from zeus_contract_compliance.domain import Document
from zeus_contract_compliance.repository import ContractRepository, DocumentRepository

log = logging.getLogger(__name__)


class UploadTooLargeError(ValueError):
    """Raised when the payload exceeds the configured ceiling."""


class DuplicateDocumentError(ValueError):
    """Raised when an identical file is already attached to the contract."""

    def __init__(self, existing: Document) -> None:
        super().__init__(f"'{existing.filename}' is already attached to this contract.")
        self.existing = existing


class QuotaExceededError(Exception):
    """Raised when an upload would exceed a plan limit. Surfaced as 402.

    Carries the numbers rather than only a sentence, so the UI can render a
    progress bar and the caller can tell "you are at 100 of 100" from "this
    one file is 40 pages and your cap is 25" without parsing prose.
    """

    def __init__(self, message: str, *, key: str, limit: int, used: int, requested: int = 0):
        super().__init__(message)
        self.key = key
        self.limit = limit
        self.used = used
        self.requested = requested


@dataclass(frozen=True, slots=True)
class IngestQuota:
    """The ceilings this upload must respect. ``None`` means unlimited.

    Resolved by the caller from the tenant's entitlements and passed in, so
    this service never reaches for claims itself and stays testable without an
    entitlement store. ``None`` for the whole quota means "not enforced here"
    -- used by internal callers that are not a customer upload.

    Every field being ``None``-means-unlimited is deliberate and matches
    DEC-10. Reading a missing limit as zero, or as a default, is what made
    enterprise plans behave like the free tier -- see D22.
    """

    pages_per_document: int | None = None
    pages_per_month: int | None = None
    documents_per_month: int | None = None


@dataclass(frozen=True, slots=True)
class IngestResult:
    document: Document
    text: str
    truncated: bool


class IngestionService:
    def __init__(
        self,
        *,
        storage: Storage,
        documents: DocumentRepository,
        contracts: ContractRepository,
        bucket: str,
        max_bytes: int,
    ) -> None:
        self._storage = storage
        self._documents = documents
        self._contracts = contracts
        self._bucket = bucket
        self._max_bytes = max_bytes

    @staticmethod
    def storage_key(tenant_id: str, contract_id: str, checksum: str, filename: str) -> str:
        return f"{tenant_id}/{contract_id}/{checksum[:16]}-{safe_filename(filename)}"

    def _validate_size(self, data: bytes) -> None:
        if len(data) > self._max_bytes:
            mb = self._max_bytes // (1024 * 1024)
            raise UploadTooLargeError(f"File exceeds the {mb} MB upload limit.")

    async def ingest(
        self,
        *,
        tenant_id: str,
        contract_id: str,
        filename: str,
        data: bytes,
        uploaded_by: str | None,
        replace_body: bool,
        quota: IngestQuota | None = None,
    ) -> IngestResult:
        """Attach a file to a contract and return the extracted text.

        ``replace_body`` sets the contract body to this document's text, making
        it the source the AI analyzes.

        Quota checks are ordered by what they cost to evaluate and by what they
        would waste if they fired late. The document count is known before the
        file is parsed, so it is checked first and a tenant already at their
        monthly cap never pays the parse. Page checks need the page count and
        so must follow extraction -- but they still run before the bytes are
        written to storage and before any row is inserted, so a refused upload
        leaves nothing behind and costs no AI spend.
        """
        self._validate_size(data)
        quota = quota or IngestQuota()

        if quota.documents_per_month is not None:
            used = await self._documents.documents_this_month(tenant_id)
            if used >= quota.documents_per_month:
                raise QuotaExceededError(
                    f"Plan limit reached: {quota.documents_per_month} documents this month. "
                    "Upgrade the Contract Compliance plan to process more.",
                    key="documents_per_month",
                    limit=quota.documents_per_month,
                    used=used,
                )

        # Raises UnsupportedDocumentError / DocumentParseError, both 4xx.
        extracted: ExtractedDocument = extract_document(data, filename=filename)

        if quota.pages_per_document is not None and extracted.pages > quota.pages_per_document:
            raise QuotaExceededError(
                f"This document is {extracted.pages} pages; your plan allows "
                f"{quota.pages_per_document} per document. Split it or upgrade the plan.",
                key="pages_per_document",
                limit=quota.pages_per_document,
                used=0,
                requested=extracted.pages,
            )

        if quota.pages_per_month is not None:
            used_pages = await self._documents.pages_this_month(tenant_id)
            # Rejected whole rather than part-processed: half a contract
            # analysed is worse than none, and there is no way to bill for it
            # honestly.
            if used_pages + extracted.pages > quota.pages_per_month:
                remaining = max(0, quota.pages_per_month - used_pages)
                raise QuotaExceededError(
                    f"This document is {extracted.pages} pages and you have "
                    f"{remaining} of {quota.pages_per_month} left this month. "
                    "Upgrade the Contract Compliance plan to process more.",
                    key="pages_per_month",
                    limit=quota.pages_per_month,
                    used=used_pages,
                    requested=extracted.pages,
                )

        duplicate = await self._documents.find_by_checksum(
            tenant_id, contract_id, extracted.checksum
        )
        if duplicate is not None:
            raise DuplicateDocumentError(duplicate)

        clean_name = safe_filename(filename)
        key = self.storage_key(tenant_id, contract_id, extracted.checksum, clean_name)
        await self._storage.put(
            self._bucket, key, data, content_type=extracted.content_type
        )

        try:
            document = await self._documents.create(
                tenant_id=tenant_id,
                contract_id=contract_id,
                filename=clean_name,
                content_type=extracted.content_type,
                byte_size=extracted.byte_size,
                storage_key=key,
                checksum=extracted.checksum,
                extracted_chars=len(extracted.text),
                pages=extracted.pages,
                page_basis=extracted.page_basis,
                uploaded_by=uploaded_by,
            )
        except Exception:
            # Compensating delete: never leave bytes without metadata.
            try:
                await self._storage.delete(self._bucket, key)
            except Exception:  # noqa: BLE001 - cleanup must not mask the cause
                log.exception("Failed to clean up orphaned object %s", key)
            raise

        if replace_body:
            await self._contracts.update(
                tenant_id,
                contract_id,
                {"body": extracted.text, "body_source": "document"},
            )

        return IngestResult(
            document=document, text=extracted.text, truncated=extracted.truncated
        )

    async def read_bytes(self, storage_key: str) -> bytes:
        return await self._storage.get(self._bucket, storage_key)

    async def remove(self, storage_key: str) -> None:
        """Best-effort object removal after the metadata row is gone.

        A failure here is logged, not raised: the document is already invisible
        to the tenant, and a stranded object is an operations concern rather
        than a user-facing error.
        """
        try:
            await self._storage.delete(self._bucket, storage_key)
        except Exception:  # noqa: BLE001
            log.exception("Failed to delete object %s", storage_key)


__all__ = [
    "IngestionService",
    "IngestResult",
    "UploadTooLargeError",
    "DuplicateDocumentError",
    "UnsupportedDocumentError",
]
