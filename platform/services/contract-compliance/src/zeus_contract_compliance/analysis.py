"""Contract analysis — the one implementation both entry points call.

Analysis is reachable two ways: inline from a request, and from a queued job.
Those used to be two copies of the same twelve steps, which had already begun
to drift — only one of them recorded a failed extraction to the metering
ledger, so every spend report was low by exactly the failures, and nothing in
the numbers said so.

Keeping it in one function makes that class of divergence impossible. The
caller supplies the two things that genuinely differ:

``actor_id``
    A person for the inline path, ``None`` for the queued one, where there is
    no interactive user to attribute the action to.
``via``
    Recorded in the audit trail so the two routes stay distinguishable after
    the fact, which is the only reason anyone needs to tell them apart.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from zeus_contract_compliance.container import Container
from zeus_contract_compliance.domain import MODULE_ID

log = logging.getLogger(__name__)


class ContractNotFound(Exception):
    """The contract does not exist, or does not belong to this tenant."""


class ContractHasNoText(Exception):
    """Nothing to analyse: no document has been uploaded or pasted yet."""


@dataclass(slots=True)
class AnalysisResult:
    contract_id: str
    obligations_created: int
    stale_removed: int
    model: str


async def analyze_contract(
    container: Container,
    *,
    tenant_id: str,
    contract_id: str,
    actor_id: str | None,
    via: str,
) -> AnalysisResult:
    """Extract obligations from a contract and persist them.

    Re-running replaces only untouched AI obligations, so human progress and
    manually authored items survive a re-analysis.

    Raises rather than returning an HTTP response, because one of the two
    callers is a background job with no request to respond to. Translating an
    exception into a status code is the router's business, not this function's.
    """
    contract = await container.contracts.get(tenant_id, contract_id)
    if contract is None:
        raise ContractNotFound(contract_id)
    if not (contract.body or "").strip():
        raise ContractHasNoText(contract_id)

    # Stale AI obligations go first so a failed extraction cannot leave the
    # previous run's output looking like the current one.
    removed = await container.obligations.delete_ai_for_contract(tenant_id, contract_id)

    try:
        result = await container.extraction.extract_detailed(contract.body or "")
    except Exception as exc:
        # A failed extraction still consumed budget and is the signal that
        # something is wrong, so it is recorded before the error propagates.
        # This must go to the same ledger as the success path -- splitting them
        # would make every rollup report a 100% success rate by construction.
        await container.metering.record(
            tenant_id=tenant_id,
            actor_id=actor_id,
            module_id=MODULE_ID,
            operation="extract_obligations",
            model=container.settings.llm.model,
            succeeded=False,
            error=str(exc),
        )
        raise

    drafts = result.obligations
    created = await container.obligations.bulk_insert_ai(
        tenant_id=tenant_id, contract_id=contract_id, drafts=drafts
    )
    await container.contracts.mark_analyzed(tenant_id, contract_id)

    await container.metering.record(
        tenant_id=tenant_id,
        actor_id=actor_id,
        module_id=MODULE_ID,
        operation="extract_obligations",
        model=result.model,
        prompt_tokens=result.prompt_tokens,
        completion_tokens=result.completion_tokens,
        latency_ms=result.latency_ms,
        # Partial success is still success: some chunks failing is a quality
        # signal, not a failed operation.
        succeeded=result.chunks_failed < result.chunks,
    )
    await container.audit.record(
        tenant_id=tenant_id,
        actor_id=actor_id,
        action="contract.analyzed",
        entity_type="contract",
        entity_id=contract_id,
        detail={
            "obligations_created": created,
            "stale_removed": removed,
            "model": result.model,
            "chunks": result.chunks,
            "chunks_failed": result.chunks_failed,
            "via": via,
        },
    )
    return AnalysisResult(
        contract_id=contract_id,
        obligations_created=created,
        stale_removed=removed,
        model=result.model,
    )
