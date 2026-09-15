"""Enrichment jobs: the queued, budgeted use of the model.

Separate from grant_jobs because the cost profile is completely different.
Ingest and scoring are free and fast; these cost money per record and run at
the speed of an API. Mixing them in one module invites someone to call an
enrichment handler from a request path by accident.

Budget is enforced by the batch size, not by hope. 49,223 records carry the
"see the text field" eligibility code, and enriching all of them in one job
would be a bill nobody approved and a job that runs for hours.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from zeus_service_kit.worker import JobContext

from zeus_platform_core.services.job_handlers import registry

log = logging.getLogger(__name__)

#: Records enriched per job. Small on purpose: each one is a model call, and a
#: job that takes minutes cannot report useful progress or be cancelled
#: cleanly. More work is done by queueing more jobs, not bigger ones.
DEFAULT_BATCH = 25

#: Ceiling regardless of what the payload asks for. Stops a mistyped payload or
#: a malicious enqueue from turning one job into a five-figure API bill.
MAX_BATCH = 200


@registry.register("enrichment.eligibility_batch")
async def enrich_eligibility(ctx: JobContext) -> dict[str, Any]:
    """Read eligibility prose for opportunities that only have code 25.

    Prioritised by deadline. A grant closing next week is worth understanding
    now; one closing in eight months can wait for tomorrow's batch, and
    spending the budget in deadline order means the money buys the most useful
    answers first.
    """
    batch = min(int(ctx.payload.get("batch", DEFAULT_BATCH)), MAX_BATCH)
    container = ctx.container
    started = time.monotonic()

    rows = await container.db.fetch(
        """
        SELECT id, eligibility_note
          FROM platform.opportunities
         WHERE enriched_at IS NULL
           AND eligibility_note IS NOT NULL
           AND length(eligibility_note) > 40
           AND NOT is_forecast
           AND (closes_on IS NULL OR closes_on >= current_date)
           -- Only the ones where codes genuinely do not answer the question.
           -- Enriching a record that already names its applicant types buys
           -- nothing and costs the same as one that does not.
           AND (eligibility_codes && ARRAY['25'] OR cardinality(eligibility_codes) = 0)
         ORDER BY closes_on ASC NULLS LAST
         LIMIT $1
        """,
        batch,
    )
    if not rows:
        return {"enriched": 0, "note": "nothing pending"}

    agent = container.enrichment
    codes = await container.opportunities.eligibility_codes()

    enriched = 0
    cache_hits = 0
    failures = 0

    for i, row in enumerate(rows):
        # Heartbeat every record: a batch of 25 model calls can run several
        # minutes, well past the lease, and losing the lease mid-batch means a
        # second worker starts paying for the same reads.
        await ctx.progress(i, len(rows))
        try:
            result = await agent.read_eligibility(
                text=row["eligibility_note"],
                codes=codes,
                opportunity_id=str(row["id"]),
            )
        except Exception:
            # One unreadable notice must not abandon the other 24. The record
            # stays unenriched and is picked up by a later batch.
            failures += 1
            log.warning("enrichment.failed id=%s", row["id"], exc_info=True)
            continue

        reading = result.reading
        await container.db.execute(
            """
            UPDATE platform.opportunities
               SET inferred_codes      = $2::text[],
                   inferred_states     = $3::text[],
                   inferred_summary    = $4,
                   inferred_confidence = $5,
                   enriched_at         = now(),
                   enrichment_version  = $6
             WHERE id = $1::uuid
            """,
            str(row["id"]),
            reading.applicant_codes,
            reading.geographic_restriction,
            reading.summary,
            reading.confidence,
            _version(),
        )
        enriched += 1
        if result.cached:
            cache_hits += 1

    await ctx.progress(len(rows), len(rows))
    return {
        "enriched": enriched,
        "cache_hits": cache_hits,
        "failures": failures,
        "seconds": round(time.monotonic() - started, 1),
    }


@registry.register("enrichment.schedule")
async def schedule_enrichment(ctx: JobContext) -> dict[str, Any]:
    """Queue enrichment batches up to a stated cap.

    The cap is the budget control. Nothing enriches unless someone asked for a
    specific number of records, so the spend is always a decision rather than a
    consequence of the backlog's size.
    """
    target = min(int(ctx.payload.get("max_records", 200)), 5000)
    batch = min(int(ctx.payload.get("batch", DEFAULT_BATCH)), MAX_BATCH)

    row = await ctx.container.db.fetch_one(
        """
        SELECT count(*) AS pending
          FROM platform.opportunities
         WHERE enriched_at IS NULL
           AND eligibility_note IS NOT NULL
           AND length(eligibility_note) > 40
           AND NOT is_forecast
           AND (closes_on IS NULL OR closes_on >= current_date)
           AND (eligibility_codes && ARRAY['25'] OR cardinality(eligibility_codes) = 0)
        """
    )
    pending = int((row or {}).get("pending") or 0)
    to_queue = min(pending, target)
    batches = (to_queue + batch - 1) // batch

    for n in range(batches):
        await ctx.container.jobs.enqueue(
            "enrichment.eligibility_batch",
            payload={"batch": batch},
            # Numbered so a re-run of the scheduler does not double the queue.
            idempotency_key=f"enrich:{_today()}:{n}",
            priority=500,  # lowest: never ahead of anything a user is waiting on
        )

    return {"pending": pending, "queued_batches": batches, "records": to_queue}


def _version() -> int:
    from zeus_platform_core.services.grant_enrichment import ENRICHMENT_VERSION

    return ENRICHMENT_VERSION


def _today() -> str:
    from datetime import UTC, datetime

    return datetime.now(UTC).strftime("%Y%m%d")
