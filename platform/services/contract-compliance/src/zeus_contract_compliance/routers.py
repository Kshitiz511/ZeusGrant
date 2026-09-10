"""HTTP routes for the Contract Compliance service.

Every route is guarded by ``require_module('contract_compliance')`` — the
service independently confirms entitlement, so it is safe to deploy and expose
on its own. The create route also enforces the plan's ``contracts_max`` limit.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from zeus_service_kit.security import require_module

from zeus_contract_compliance.container import Container
from zeus_contract_compliance.domain import (
    MODULE_ID,
    Contract,
    ContractCreate,
    Obligation,
)
from zeus_contract_compliance.jobs import ANALYZE_TOPIC

router = APIRouter(prefix="/contracts", tags=["contracts"])

# Guard yields the entitled tenant_id; reused by every route below.
TenantDep = Annotated[str, Depends(require_module(MODULE_ID))]


def _container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(_container)]


async def _enforce_contract_limit(container: Container, tenant_id: str) -> None:
    claims = await container.security.claims_for(tenant_id)
    ent = (claims.get("modules") or {}).get(MODULE_ID) or {}
    limit = (ent.get("limits") or {}).get("contracts_max")
    if limit is None:  # unlimited or unknown
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


@router.post("", response_model=Contract, status_code=status.HTTP_201_CREATED)
async def create_contract(
    body: ContractCreate, container: ContainerDep, tenant_id: TenantDep
) -> Contract:
    await _enforce_contract_limit(container, tenant_id)
    return await container.contracts.create(
        tenant_id=tenant_id,
        title=body.title,
        counterparty=body.counterparty,
        body=body.body,
        created_by=None,
    )


@router.get("", response_model=list[Contract])
async def list_contracts(container: ContainerDep, tenant_id: TenantDep) -> list[Contract]:
    return await container.contracts.list_for_tenant(tenant_id)


@router.get("/{contract_id}", response_model=Contract)
async def get_contract(
    contract_id: str, container: ContainerDep, tenant_id: TenantDep
) -> Contract:
    contract = await container.contracts.get(tenant_id, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return contract


@router.get("/{contract_id}/obligations", response_model=list[Obligation])
async def list_obligations(
    contract_id: str, container: ContainerDep, tenant_id: TenantDep
) -> list[Obligation]:
    return await container.obligations.list_for_contract(tenant_id, contract_id)


@router.post("/{contract_id}/analyze", response_model=list[Obligation])
async def analyze_contract(
    contract_id: str,
    container: ContainerDep,
    tenant_id: TenantDep,
    response: Response,
    async_mode: bool = False,
) -> list[Obligation]:
    """Run AI extraction over the contract body and persist the obligations.

    Sync (default): extract inline and return the obligations.
    Async (``?async_mode=true``): enqueue the job and return 202 immediately;
    the queue calls back into ``/internal/jobs/analyze`` to do the work. This
    keeps request latency low for large contracts and slow models.
    """
    contract = await container.contracts.get(tenant_id, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")

    if async_mode:
        await container.queue.publish(
            ANALYZE_TOPIC, {"tenant_id": tenant_id, "contract_id": contract_id}
        )
        response.status_code = status.HTTP_202_ACCEPTED
        return []

    drafts = await container.extraction.extract(contract.body or "")
    await container.obligations.bulk_insert_ai(
        tenant_id=tenant_id, contract_id=contract_id, drafts=drafts
    )
    return await container.obligations.list_for_contract(tenant_id, contract_id)
