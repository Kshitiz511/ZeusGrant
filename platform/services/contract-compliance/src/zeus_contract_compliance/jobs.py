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

        drafts = await container.extraction.extract(contract.body or "")
        created = await container.obligations.bulk_insert_ai(
            tenant_id=job.tenant_id, contract_id=job.contract_id, drafts=drafts
        )
    return JobResult(contract_id=job.contract_id, obligations_created=created)
