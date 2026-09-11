"""Internal worker endpoints — the async AI path.

Serverless-native design: instead of a long-lived worker process, the queue
(QStash in prod, in-memory in dev) delivers a job by calling this endpoint over
HTTP. It is machine-to-machine, authenticated by a shared worker secret, and
trusts the payload's tenant context. Never expose this without the secret set.

Topic contract: ``contract.analyze`` with payload {tenant_id, contract_id}.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel
from zeus_adapters.db.tenant_context import tenant_scope

from zeus_contract_compliance.container import Container

router = APIRouter(prefix="/internal/jobs", tags=["internal"])

ANALYZE_TOPIC = "contract.analyze"


class AnalyzeJob(BaseModel):
    tenant_id: str
    contract_id: str


class JobResult(BaseModel):
    contract_id: str
    obligations_created: int


def _container(request: Request) -> Container:
    return request.app.state.container


def _authorize(container: Container, provided: str | None) -> None:
    secret = container.settings.worker_secret
    if secret is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if provided != secret.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid worker secret."
        )


@router.post("/analyze", response_model=JobResult)
async def run_analyze_job(
    job: AnalyzeJob,
    request: Request,
    x_worker_secret: Annotated[str | None, Header()] = None,
) -> JobResult:
    """Process a queued analyze job: extract obligations and persist them.

    This is what the queue calls back into. Idempotency and retries are the
    queue's responsibility; this handler is pure work.
    """
    container = _container(request)
    _authorize(container, x_worker_secret)

    # Jobs run outside a request context, so bind the payload's tenant
    # explicitly — RLS applies to the worker path exactly like the API path.
    with tenant_scope(job.tenant_id):
        contract = await container.contracts.get(job.tenant_id, job.contract_id)
        if contract is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found."
            )

        # Same semantics as the synchronous route: untouched AI obligations are
        # replaced, manual and in-progress ones survive.
        removed = await container.obligations.delete_ai_for_contract(
            job.tenant_id, job.contract_id
        )

        drafts = None
        try:
            drafts = await container.extraction.extract_detailed(contract.body or "")
        except Exception as exc:
            # Parity with the synchronous route. Without this the queued path --
            # which becomes the primary path once extraction moves off the
            # request -- would burn budget on failures that never appear in any
            # ledger, and the spend figures would drift low with no way to tell.
            await container.metering.record(
                tenant_id=job.tenant_id,
                actor_id=None,
                module_id="contract_compliance",
                operation="extract_obligations",
                model=container.settings.llm.model,
                succeeded=False,
                error=str(exc),
            )
            raise

        created = await container.obligations.bulk_insert_ai(
            tenant_id=job.tenant_id, contract_id=job.contract_id, drafts=drafts.obligations
        )
        await container.contracts.mark_analyzed(job.tenant_id, job.contract_id)
        await container.metering.record(
            tenant_id=job.tenant_id,
            actor_id=None,
            module_id="contract_compliance",
            operation="extract_obligations",
            model=drafts.model,
            prompt_tokens=drafts.prompt_tokens,
            completion_tokens=drafts.completion_tokens,
            latency_ms=drafts.latency_ms,
            succeeded=drafts.chunks_failed < drafts.chunks,
        )
        await container.audit.record(
            tenant_id=job.tenant_id,
            actor_id=None,  # queue-driven, so there is no interactive user
            action="contract.analyzed",
            entity_type="contract",
            entity_id=job.contract_id,
            detail={
                "obligations_created": created,
                "stale_removed": removed,
                "model": drafts.model,
                "chunks": drafts.chunks,
                "chunks_failed": drafts.chunks_failed,
                "via": "queue",
            },
        )
    return JobResult(contract_id=job.contract_id, obligations_created=created)
