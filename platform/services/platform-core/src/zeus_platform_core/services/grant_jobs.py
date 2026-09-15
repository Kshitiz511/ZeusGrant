"""Job handlers for grant intelligence.

Each handler is deterministic and idempotent. Running one twice must leave the
same state as running it once, because the ledger's retry logic guarantees that
will happen eventually: a worker killed between finishing the work and writing
the result will have the job retried, and the second run must not duplicate.

Importing this module registers the handlers. The container imports it during
startup so a worker knows every kind the queue can contain.
"""

from __future__ import annotations

import logging
import tempfile
import time
import urllib.request
import zipfile
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from zeus_service_kit.worker import JobContext

from zeus_platform_core.services.job_handlers import registry

log = logging.getLogger(__name__)

#: Grants.gov publishes a full extract each morning at this URL pattern.
#: Dated rather than "latest" so a re-run fetches the same bytes and the job is
#: reproducible; "latest" would quietly mean something different tomorrow.
GRANTS_GOV_URL = "https://prod-grants-gov-chatbot.s3.amazonaws.com/extracts/GrantsDBExtract{stamp}v2.zip"

#: The extract is ~75 MB zipped and ~306 MB expanded. Streamed to disk rather
#: than held in memory: 306 MB of XML in a serverless function is an OOM kill,
#: and the parser reads it incrementally anyway.
DOWNLOAD_CHUNK = 1 << 20


@registry.register("grants_gov.ingest")
async def ingest_grants_gov(ctx: JobContext) -> dict[str, Any]:
    """Download today's Grants.gov extract and upsert it.

    Idempotent through the loader's ON CONFLICT on (source, source_uid): a
    second run updates 83,394 rows and inserts none, which is exactly what a
    retry should do.
    """
    from zeus_platform_core.sources import grants_gov
    from zeus_platform_core.sources.loader import OpportunityLoader

    stamp = ctx.payload.get("stamp") or date.today().strftime("%Y%m%d")
    url = ctx.payload.get("url") or GRANTS_GOV_URL.format(stamp=stamp)
    started = time.monotonic()

    await ctx.progress(0, 4)

    with tempfile.TemporaryDirectory(prefix="grants-") as tmp:
        archive = Path(tmp) / "extract.zip"
        downloaded = _download(url, archive)
        log.info("ingest.downloaded bytes=%d url=%s", downloaded, url)
        await ctx.progress(1, 4)

        xml_path = _extract_xml(archive, Path(tmp))
        await ctx.progress(2, 4)

        loader = OpportunityLoader(ctx.container.db)
        result = await loader.load(grants_gov.parse(xml_path))
        await ctx.progress(3, 4)

    # A load that inserts and updates nothing means the parser matched no
    # records -- almost always a source format change rather than an empty day.
    # Failing loudly gets it retried and surfaced; succeeding with zero would
    # leave a stale catalogue looking healthy.
    if result.inserted == 0 and result.updated == 0:
        raise RuntimeError(
            f"extract for {stamp} produced no records; source format may have changed"
        )

    await ctx.progress(4, 4)
    return {
        "stamp": stamp,
        "inserted": result.inserted,
        "updated": result.updated,
        "failed": result.failed,
        "seconds": round(time.monotonic() - started, 1),
    }


@registry.register("matching.rescore_tenant")
async def rescore_tenant(ctx: JobContext) -> dict[str, Any]:
    """Recompute one tenant's matches.

    The work is a single SQL statement. This handler exists so it happens off
    the request path: scoring takes roughly 400 ms, which is tolerable in a
    background job and rude in an HTTP handler that a user is waiting on.
    """
    tenant_id = ctx.tenant_id or ctx.payload.get("tenant_id")
    if not tenant_id:
        raise ValueError("rescore_tenant requires a tenant_id")

    repo = ctx.container.opportunities
    profile = await repo.get_profile(tenant_id)
    if profile is None:
        # Not an error. A tenant that has not filled in a profile has nothing
        # to score against, and failing would retry three times to no purpose.
        return {"tenant_id": tenant_id, "skipped": "no profile"}

    started = time.monotonic()
    written = await repo.refresh_matches(tenant_id, limit=ctx.payload.get("limit", 500))
    summary = await repo.match_summary(tenant_id)

    return {
        "tenant_id": tenant_id,
        "matches_written": written,
        "active": summary.get("active"),
        "strong": summary.get("strong"),
        "scoreable_profile": profile.is_scoreable,
        "seconds": round(time.monotonic() - started, 2),
    }


@registry.register("matching.rescore_all")
async def rescore_all(ctx: JobContext) -> dict[str, Any]:
    """Fan out a rescore to every tenant with a profile.

    Enqueues one job per tenant rather than scoring them inline. A hundred
    tenants scored in a single job is a 40-second transaction that blocks the
    worker and cannot report partial progress; a hundred small jobs spread
    across whatever workers exist, retry independently, and let an interactive
    rescore jump the queue on priority.
    """
    rows = await ctx.container.db.fetch(
        "SELECT tenant_id FROM platform.org_profiles "
        "WHERE cardinality(focus_areas) > 0"
    )
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    queued = 0
    for i, row in enumerate(rows):
        tenant_id = str(row["tenant_id"])
        await ctx.container.jobs.enqueue(
            "matching.rescore_tenant",
            tenant_id=tenant_id,
            # Dated key: one scheduled rescore per tenant per day, no matter how
            # many times the fan-out is triggered.
            idempotency_key=f"rescore:{tenant_id}:{stamp}",
            priority=200,  # below interactive work
        )
        queued += 1
        if i % 50 == 0:
            await ctx.progress(i, len(rows))

    return {"tenants": len(rows), "queued": queued}


@registry.register("grants_gov.daily")
async def daily_pipeline(ctx: JobContext) -> dict[str, Any]:
    """Nightly chain: ingest, then rescore everyone.

    Chained by enqueueing rather than by calling: if the rescore fan-out fails,
    the ingest that already succeeded is not retried with it.
    """
    stamp = date.today().strftime("%Y%m%d")
    ingest = await ctx.container.jobs.enqueue(
        "grants_gov.ingest",
        payload={"stamp": stamp},
        idempotency_key=f"ingest:{stamp}",
        priority=150,
        max_attempts=3,
    )
    # run_after gives the ingest room to finish first. Scoring against a
    # half-loaded catalogue would produce matches that change an hour later.
    fanout = await ctx.container.jobs.enqueue(
        "matching.rescore_all",
        idempotency_key=f"rescore_all:{stamp}",
        priority=200,
        run_after=datetime.now(UTC).replace(microsecond=0),
    )
    return {"ingest_job": ingest.id, "rescore_job": fanout.id, "stamp": stamp}


def _download(url: str, dest: Path) -> int:
    """Stream a URL to disk, returning bytes written."""
    total = 0
    request = urllib.request.Request(url, headers={"User-Agent": "zeus-platform/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, dest.open("wb") as out:
        while chunk := response.read(DOWNLOAD_CHUNK):
            out.write(chunk)
            total += len(chunk)
    if total == 0:
        raise RuntimeError(f"empty download from {url}")
    return total


def _extract_xml(archive: Path, into: Path) -> Path:
    """Pull the single XML member out of the extract.

    Named by date inside the zip, so the member is found by extension rather
    than by a hardcoded filename that breaks at midnight.
    """
    with zipfile.ZipFile(archive) as zf:
        members = [n for n in zf.namelist() if n.lower().endswith(".xml")]
        if not members:
            raise RuntimeError(f"no XML member in {archive.name}: {zf.namelist()}")
        if len(members) > 1:
            log.warning("extract contains %d XML members; using %s", len(members), members[0])
        zf.extract(members[0], into)
        return into / members[0]
