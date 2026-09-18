"""HTTP routes for the Contract Compliance service.

Every route is guarded by ``require_module('contract_compliance')`` — the
service independently confirms entitlement, so it is safe to deploy and expose
on its own. Creation routes additionally enforce the plan's ``contracts_max``
limit, and every mutation is written to the append-only audit log.

Conventions used throughout:
  * Reads that miss return 404; they never leak whether the id exists in
    another tenant, because the query is tenant-scoped and RLS backs it up.
  * Partial updates use ``model_fields_set`` so "field omitted" and "field set
    to null" are different operations.
  * Uploads are size-capped while streaming, before any parsing happens.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from zeus_service_kit.security import ActorDep, require_module

from zeus_contract_compliance.analysis import (
    ContractHasNoText,
    ContractNotFound,
)
from zeus_contract_compliance.analysis import analyze_contract as _analyze
from zeus_contract_compliance.container import Container
from zeus_contract_compliance.documents import (
    ALLOWED_EXTENSIONS,
    DocumentParseError,
    UnsupportedDocumentError,
)
from zeus_contract_compliance.domain import (
    ANALYZE_KIND,
    MODULE_ID,
    AuditEntry,
    Contract,
    ContractCreate,
    ContractUpdate,
    Document,
    Obligation,
    ObligationCreate,
    ObligationStatus,
    ObligationUpdate,
    ObligationWithContract,
)
from zeus_contract_compliance.ingestion import (
    DuplicateDocumentError,
    IngestQuota,
    QuotaExceededError,
    UploadTooLargeError,
)

router = APIRouter(prefix="/contracts", tags=["contracts"])
obligations_router = APIRouter(prefix="/obligations", tags=["obligations"])
audit_router = APIRouter(prefix="/audit", tags=["audit"])

# Guard yields the entitled tenant_id; reused by every route below.
TenantDep = Annotated[str, Depends(require_module(MODULE_ID))]


def _container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(_container)]


# --- helpers ----------------------------------------------------------------


async def _plan_limits(container: Container, tenant_id: str) -> dict[str, Any]:
    """The tenant's limit map for this module, or empty when unentitled.

    One place reads claims, so every limit in this service agrees about what
    the data means. D22 happened because two modules each resolved limits
    their own way and quietly disagreed.
    """
    claims = await container.security.claims_for(tenant_id)
    ent = (claims.get("modules") or {}).get(MODULE_ID) or {}
    return ent.get("limits") or {}


def _ceiling(limits: dict[str, Any], key: str) -> int | None:
    """A stated ceiling, or ``None`` for unlimited (DEC-10).

    An absent key and a NULL value mean the same thing: no ceiling. Every
    ``*_enterprise`` plan is seeded with no limit rows at all and relies on
    this. Do not add a default here -- that is precisely the D22 defect.
    """
    value = limits.get(key)
    return None if value is None else int(value)


async def _enforce_contract_limit(container: Container, tenant_id: str) -> None:
    """Refuse a new contract once the plan's ceiling is reached."""
    limit = _ceiling(await _plan_limits(container, tenant_id), "contracts_max")
    if limit is None:  # unlimited
        return
    used = await container.contracts.count_for_tenant(tenant_id)
    if used >= int(limit):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Plan limit reached: {limit} contract(s). "
                "Upgrade the Contract Compliance plan to add more."
            ),
        )


async def _require_contract(container: Container, tenant_id: str, contract_id: str) -> Contract:
    contract = await container.contracts.get(tenant_id, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return contract


async def _audit(
    container: Container,
    *,
    tenant_id: str,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Record an audit entry.

    The write is intentionally awaited rather than backgrounded: an action the
    trail cannot record is an action that should fail loudly.
    """
    await container.audit.record(
        tenant_id=tenant_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        detail=detail,
    )


def _changed_fields(payload: ContractUpdate | ObligationUpdate) -> dict[str, Any]:
    """Only the fields the caller actually sent, serialized for SQL."""
    provided = payload.model_dump(include=payload.model_fields_set)
    return {k: (str(v) if hasattr(v, "value") else v) for k, v in provided.items()}


# --- contracts --------------------------------------------------------------


@router.post("", response_model=Contract, status_code=status.HTTP_201_CREATED)
async def create_contract(
    body: ContractCreate,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Contract:
    await _enforce_contract_limit(container, tenant_id)
    contract = await container.contracts.create(
        tenant_id=tenant_id,
        title=body.title,
        counterparty=body.counterparty,
        body=body.body,
        created_by=actor_id,
    )
    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="contract.created",
        entity_type="contract",
        entity_id=contract.id,
        detail={"title": contract.title},
    )
    return contract


@router.get("", response_model=list[Contract])
async def list_contracts(container: ContainerDep, tenant_id: TenantDep) -> list[Contract]:
    return await container.contracts.list_for_tenant(tenant_id)


@router.get("/{contract_id}", response_model=Contract)
async def get_contract(
    contract_id: str, container: ContainerDep, tenant_id: TenantDep
) -> Contract:
    return await _require_contract(container, tenant_id, contract_id)


@router.patch("/{contract_id}", response_model=Contract)
async def update_contract(
    contract_id: str,
    body: ContractUpdate,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Contract:
    await _require_contract(container, tenant_id, contract_id)

    updates = _changed_fields(body)
    if "body" in updates:
        # Editing the text by hand means it is no longer the document's copy.
        updates["body_source"] = "manual"

    contract = await container.contracts.update(tenant_id, contract_id, updates)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")

    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="contract.updated",
        entity_type="contract",
        entity_id=contract_id,
        # Field names only — the trail records what changed, not the content.
        detail={"fields": sorted(updates)},
    )
    return contract


@router.delete("/{contract_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contract(
    contract_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Response:
    contract = await _require_contract(container, tenant_id, contract_id)

    # Collect storage keys before the cascade removes the metadata rows.
    keys = await container.documents.list_storage_keys(tenant_id, contract_id)

    if not await container.contracts.delete(tenant_id, contract_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")

    for key in keys:
        await container.ingestion.remove(key)

    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="contract.deleted",
        entity_type="contract",
        entity_id=contract_id,
        detail={"title": contract.title, "documents_removed": len(keys)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- documents --------------------------------------------------------------


@router.post(
    "/{contract_id}/documents",
    response_model=Document,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    contract_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
    file: Annotated[UploadFile, File(description=f"One of: {', '.join(ALLOWED_EXTENSIONS)}")],
    replace_body: bool = Query(
        default=True,
        description="Use this document's text as the contract body for AI analysis.",
    ),
) -> Document:
    await _require_contract(container, tenant_id, contract_id)

    max_bytes = container.settings.storage.max_upload_bytes
    data = await _read_capped(file, max_bytes)

    limits = await _plan_limits(container, tenant_id)
    quota = IngestQuota(
        pages_per_document=_ceiling(limits, "pages_per_document"),
        pages_per_month=_ceiling(limits, "pages_per_month"),
        documents_per_month=_ceiling(limits, "documents_per_month"),
    )

    try:
        result = await container.ingestion.ingest(
            tenant_id=tenant_id,
            contract_id=contract_id,
            filename=file.filename or "document",
            data=data,
            uploaded_by=actor_id,
            replace_body=replace_body,
            quota=quota,
        )
    except QuotaExceededError as exc:
        # 402, not 403: the request is authorised and well-formed, it is the
        # plan that is in the way. The numbers are echoed so the UI can show
        # progress rather than only an apology.
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "limit_exceeded",
                "message": str(exc),
                "limit_key": exc.key,
                "limit": exc.limit,
                "used": exc.used,
                "requested": exc.requested,
            },
        ) from exc
    except UploadTooLargeError as exc:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail=str(exc)
        ) from exc
    except DuplicateDocumentError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except (UnsupportedDocumentError, DocumentParseError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc

    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="document.uploaded",
        entity_type="document",
        entity_id=result.document.id,
        detail={
            "contract_id": contract_id,
            "filename": result.document.filename,
            "bytes": result.document.byte_size,
            "extracted_chars": result.document.extracted_chars,
            "pages": result.document.pages,
            "page_basis": result.document.page_basis,
            "truncated": result.truncated,
        },
    )
    return result.document


async def _read_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload, aborting as soon as it exceeds ``max_bytes``.

    Streaming the cap matters: it bounds memory regardless of what the client
    claims in Content-Length, which is not trustworthy.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await file.read(1024 * 256):
        total += len(chunk)
        if total > max_bytes:
            mb = max_bytes // (1024 * 1024)
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"File exceeds the {mb} MB upload limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.get("/{contract_id}/documents", response_model=list[Document])
async def list_documents(
    contract_id: str, container: ContainerDep, tenant_id: TenantDep
) -> list[Document]:
    await _require_contract(container, tenant_id, contract_id)
    return await container.documents.list_for_contract(tenant_id, contract_id)


@router.get("/{contract_id}/documents/{document_id}/download")
async def download_document(
    contract_id: str,
    document_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
) -> Response:
    """Stream the original file through the service's own auth.

    Deliberately not a public signed URL: entitlement and tenancy are checked
    on every download, and the object store stays private.
    """
    row = await container.documents.get_with_key(tenant_id, document_id)
    if row is None or row["contract_id"] != contract_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    try:
        data = await container.ingestion.read_bytes(row["storage_key"])
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE, detail="The stored file is no longer available."
        ) from exc

    # filename was sanitized on upload, so it is safe in the header.
    return Response(
        content=data,
        media_type=row["content_type"],
        headers={
            "Content-Disposition": f'attachment; filename="{row["filename"]}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete(
    "/{contract_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_document(
    contract_id: str,
    document_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Response:
    row = await container.documents.get_with_key(tenant_id, document_id)
    if row is None or row["contract_id"] != contract_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    await container.documents.delete(tenant_id, document_id)
    await container.ingestion.remove(row["storage_key"])

    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="document.deleted",
        entity_type="document",
        entity_id=document_id,
        detail={"contract_id": contract_id, "filename": row["filename"]},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- obligations ------------------------------------------------------------


@router.get("/{contract_id}/obligations", response_model=list[Obligation])
async def list_obligations(
    contract_id: str, container: ContainerDep, tenant_id: TenantDep
) -> list[Obligation]:
    return await container.obligations.list_for_contract(tenant_id, contract_id)


@router.post(
    "/{contract_id}/obligations",
    response_model=Obligation,
    status_code=status.HTTP_201_CREATED,
)
async def create_obligation(
    contract_id: str,
    body: ObligationCreate,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Obligation:
    await _require_contract(container, tenant_id, contract_id)
    obligation = await container.obligations.create(
        tenant_id=tenant_id, contract_id=contract_id, payload=body
    )
    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="obligation.created",
        entity_type="obligation",
        entity_id=obligation.id,
        detail={"contract_id": contract_id, "source": "manual"},
    )
    return obligation


@obligations_router.get("", response_model=list[ObligationWithContract])
async def list_tenant_obligations(
    container: ContainerDep,
    tenant_id: TenantDep,
    obligation_status: Annotated[ObligationStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[ObligationWithContract]:
    """Tenant-wide task feed across every contract."""
    return await container.obligations.list_for_tenant(
        tenant_id,
        status=str(obligation_status) if obligation_status else None,
        limit=limit,
    )


@obligations_router.patch("/{obligation_id}", response_model=Obligation)
async def update_obligation(
    obligation_id: str,
    body: ObligationUpdate,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Obligation:
    existing = await container.obligations.get(tenant_id, obligation_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obligation not found.")

    updates = _changed_fields(body)
    obligation = await container.obligations.update(tenant_id, obligation_id, updates)
    if obligation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obligation not found.")

    detail: dict[str, Any] = {"fields": sorted(updates)}
    if "status" in updates:
        # Status transitions are the compliance-relevant event, so record both
        # sides of the change explicitly.
        detail["from_status"] = str(existing.status)
        detail["to_status"] = updates["status"]

    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="obligation.updated",
        entity_type="obligation",
        entity_id=obligation_id,
        detail=detail,
    )
    return obligation


@obligations_router.delete("/{obligation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_obligation(
    obligation_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
) -> Response:
    if not await container.obligations.delete(tenant_id, obligation_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Obligation not found.")
    await _audit(
        container,
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="obligation.deleted",
        entity_type="obligation",
        entity_id=obligation_id,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- analysis ---------------------------------------------------------------


@router.post("/{contract_id}/analyze", response_model=list[Obligation])
async def analyze_contract(
    contract_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    actor_id: ActorDep,
    response: Response,
    async_mode: bool = False,
) -> list[Obligation]:
    """Run AI extraction over the contract body and persist the obligations.

    Sync (default): extract inline and return the obligations.
    Async (``?async_mode=true``): record the job and return 202 with a job id
    in the ``X-Job-Id`` header for the client to poll. This keeps request
    latency low for large contracts and slow models, and is the only viable
    path on a platform with a 60-second function limit.

    Re-running replaces only untouched AI obligations, so human progress and
    manually authored items survive a re-analysis.
    """
    contract = await _require_contract(container, tenant_id, contract_id)

    if not (contract.body or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="This contract has no text yet. Upload a document or paste the text first.",
        )

    if async_mode:
        # Keyed on the contract, so a double-clicked button collapses into the
        # one job already in flight instead of starting a second analysis that
        # would delete the first one's obligations halfway through writing
        # them. The key frees up once the job finishes, so a deliberate
        # re-analysis later still works.
        job = await container.jobs.enqueue(
            ANALYZE_KIND,
            payload={"tenant_id": tenant_id, "contract_id": contract_id},
            tenant_id=tenant_id,
            idempotency_key=f"analyze:{tenant_id}:{contract_id}",
            priority=10,  # a user is waiting: ahead of every scheduled job
        )
        await _audit(
            container,
            tenant_id=tenant_id,
            actor_id=actor_id,
            action="contract.analyze_queued",
            entity_type="contract",
            entity_id=contract_id,
            detail={"job_id": job.id, "deduplicated": job.attempts > 0},
        )
        response.status_code = status.HTTP_202_ACCEPTED
        response.headers["X-Job-Id"] = job.id
        return []

    try:
        result = await _analyze(
            container,
            tenant_id=tenant_id,
            contract_id=contract_id,
            actor_id=actor_id,
            via="request",
        )
    except (ContractNotFound, ContractHasNoText):
        # Both were already ruled out above, so reaching here means the
        # contract changed underneath this request.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This contract changed while it was being analysed. Try again.",
        ) from None
    except Exception as exc:
        # The spend was already recorded by _analyze before it re-raised, so
        # this only has to translate the fault into something a user can act on.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI analysis is temporarily unavailable. Please try again shortly.",
        ) from exc

    return await container.obligations.list_for_contract(tenant_id, result.contract_id)


# --- audit trail ------------------------------------------------------------


@audit_router.get("", response_model=list[AuditEntry])
async def list_audit(
    container: ContainerDep,
    tenant_id: TenantDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> list[AuditEntry]:
    """The tenant's own append-only activity trail."""
    return await container.audit.list_for_tenant(tenant_id, limit=limit)
