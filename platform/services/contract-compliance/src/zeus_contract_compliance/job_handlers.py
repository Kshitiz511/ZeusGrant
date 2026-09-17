"""Contract Compliance background jobs.

Two things live here: the handler registry for this module, and the handlers
themselves.

The registry is per-module rather than process-wide because both services are
mounted into one ASGI app in production. A shared registry would make every
module's handlers reachable from every module's worker, which would quietly
undo the isolation that lets the services be sold separately.

Analysis used to run here directly, as a fire-and-forget HTTP callback from
the queue with no record of its own. That had three faults worth naming, since
this module exists to fix them:

* **Nothing to poll.** The request returned 202 and an empty list, so the UI
  could only re-fetch obligations and guess whether anything had happened.
* **Not idempotent.** Two clicks published two messages, and QStash retries on
  failure. Two handlers overlapping would have one wiping the other's output
  mid-write, because analysis deletes stale rows before inserting new ones.
* **Silent loss.** A dropped message left no trace, so nobody could discover
  the work had never run.

The ledger fixes all three: the idempotency key collapses duplicates, the job
id is pollable, and a job that is never delivered is still queued and will be
picked up by the next sweep.
"""

from __future__ import annotations

import logging
from typing import Any

from zeus_adapters.db.tenant_context import tenant_scope
from zeus_service_kit.worker import HandlerRegistry, JobContext

from zeus_contract_compliance.analysis import (
    ContractHasNoText,
    ContractNotFound,
    analyze_contract,
)
from zeus_contract_compliance.domain import ANALYZE_KIND

log = logging.getLogger(__name__)

registry = HandlerRegistry()


@registry.register(ANALYZE_KIND)
async def analyze_job(ctx: JobContext) -> dict[str, Any]:
    """Run extraction for one contract.

    Returns a result dict rather than raising on a missing contract: a
    contract deleted between enqueue and run is a normal race, and retrying it
    three times will not make it reappear. A genuine fault still raises, so the
    worker records it and backs off.
    """
    tenant_id: str = ctx.payload["tenant_id"]
    contract_id: str = ctx.payload["contract_id"]

    # Extraction is one long LLM call, so there is no loop to report from. The
    # two checkpoints still earn their place: the first is what makes an
    # operator's cancel bite, because ctx.progress raises JobLost once the job
    # is no longer 'running', and without it this handler would run to
    # completion -- and to full model spend -- after being cancelled. The second
    # distinguishes "still calling the model" from "finished but not yet
    # recorded" on the admin screen, which are minutes apart for a long
    # contract.
    await ctx.progress(0, 2)

    # Jobs run outside a request context, so bind the payload's tenant
    # explicitly — RLS applies to the worker path exactly like the API path.
    with tenant_scope(tenant_id):
        try:
            result = await analyze_contract(
                ctx.container,
                tenant_id=tenant_id,
                contract_id=contract_id,
                actor_id=None,  # queue-driven, so there is no interactive user
                via="queue",
            )
        except ContractNotFound:
            log.warning("contract.analyze_missing contract=%s", contract_id)
            return {"contract_id": contract_id, "skipped": "contract not found"}
        except ContractHasNoText:
            log.warning("contract.analyze_empty contract=%s", contract_id)
            return {"contract_id": contract_id, "skipped": "contract has no text"}

    await ctx.progress(2, 2)

    return {
        "contract_id": result.contract_id,
        "obligations_created": result.obligations_created,
        "stale_removed": result.stale_removed,
        "model": result.model,
    }
