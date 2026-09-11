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
    ) -> IngestResult:
        """Attach a file to a contract and return the extracted text.

        ``replace_body`` sets the contract body to this document's text, making
        it the source the AI analyzes.
        """
        self._validate_size(data)

        # Raises UnsupportedDocumentError / DocumentParseError, both 4xx.
        extracted: ExtractedDocument = extract_document(data, filename=filename)

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
