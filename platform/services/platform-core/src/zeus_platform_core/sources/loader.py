"""Write parsed opportunities into the database.

Separate from the parser so the two can be tested apart: the parser is pure
XML-to-dataclass with no I/O, this is pure persistence with no parsing.

The load is an upsert keyed on (source, source_uid). Grants.gov republishes the
whole catalogue every day, so a plain insert would add 83,000 duplicates per
run. Upserting also makes a re-run after a crash safe.

Each batch is a single statement. The ``Database`` interface has no
``executemany``, and 83,000 individual round trips would be dominated by
latency, so a batch is sent as one JSON document and expanded server-side with
``jsonb_to_recordset``. That also carries the array columns without the
rectangular-shape restriction a Postgres array-of-arrays parameter would
impose.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date

from zeus_adapters.interfaces import Database

from zeus_platform_core.sources.grants_gov import Opportunity

log = logging.getLogger(__name__)

# Rows per statement. Large enough to amortise round-trip latency, small
# enough that one poison row costs a small retry rather than the whole run.
BATCH_SIZE = 1000


@dataclass(slots=True)
class LoadResult:
    inserted: int = 0
    updated: int = 0
    failed: int = 0

    @property
    def total(self) -> int:
        return self.inserted + self.updated


_UPSERT = """
INSERT INTO platform.opportunities (
    source, source_uid, source_url, title, description,
    agency_name, agency_code, opportunity_number, is_forecast,
    posted_on, closes_on, close_note, archives_on,
    award_floor, award_ceiling, total_program_funding,
    expected_award_count, cost_sharing_required,
    eligibility_codes, category_codes, funding_instruments,
    cfda_numbers, eligibility_note, last_seen_at
)
SELECT
    r.source, r.source_uid, r.source_url, r.title, r.description,
    r.agency_name, r.agency_code, r.opportunity_number, r.is_forecast,
    r.posted_on, r.closes_on, r.close_note, r.archives_on,
    r.award_floor, r.award_ceiling, r.total_program_funding,
    r.expected_award_count, r.cost_sharing_required,
    r.eligibility_codes, r.category_codes, r.funding_instruments,
    r.cfda_numbers, r.eligibility_note, now()
FROM jsonb_to_recordset($1::jsonb) AS r (
    source text, source_uid text, source_url text, title text, description text,
    agency_name text, agency_code text, opportunity_number text, is_forecast boolean,
    posted_on date, closes_on date, close_note text, archives_on date,
    award_floor numeric, award_ceiling numeric, total_program_funding numeric,
    expected_award_count integer, cost_sharing_required boolean,
    eligibility_codes text[], category_codes text[], funding_instruments text[],
    cfda_numbers text[], eligibility_note text
)
ON CONFLICT (source, source_uid) DO UPDATE SET
    source_url            = EXCLUDED.source_url,
    title                 = EXCLUDED.title,
    description           = EXCLUDED.description,
    agency_name           = EXCLUDED.agency_name,
    agency_code           = EXCLUDED.agency_code,
    opportunity_number    = EXCLUDED.opportunity_number,
    is_forecast           = EXCLUDED.is_forecast,
    posted_on             = EXCLUDED.posted_on,
    closes_on             = EXCLUDED.closes_on,
    close_note            = EXCLUDED.close_note,
    archives_on           = EXCLUDED.archives_on,
    award_floor           = EXCLUDED.award_floor,
    award_ceiling         = EXCLUDED.award_ceiling,
    total_program_funding = EXCLUDED.total_program_funding,
    expected_award_count  = EXCLUDED.expected_award_count,
    cost_sharing_required = EXCLUDED.cost_sharing_required,
    eligibility_codes     = EXCLUDED.eligibility_codes,
    category_codes        = EXCLUDED.category_codes,
    funding_instruments   = EXCLUDED.funding_instruments,
    cfda_numbers          = EXCLUDED.cfda_numbers,
    eligibility_note      = EXCLUDED.eligibility_note,
    -- Always advanced, even when nothing else changed. This is the only
    -- column that can distinguish "still in today's feed" from "withdrawn
    -- by the funder".
    last_seen_at          = now(),
    updated_at            = now()
-- xmax is 0 for a fresh insert and non-zero for an update; it is the only way
-- to tell the two apart within one statement.
RETURNING (xmax = 0) AS was_inserted
"""


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _as_json_row(o: Opportunity) -> dict:
    return {
        "source": o.source,
        "source_uid": o.source_uid,
        "source_url": o.source_url,
        "title": o.title,
        "description": o.description,
        "agency_name": o.agency_name,
        "agency_code": o.agency_code,
        "opportunity_number": o.opportunity_number,
        "is_forecast": o.is_forecast,
        "posted_on": _iso(o.posted_on),
        "closes_on": _iso(o.closes_on),
        "close_note": o.close_note,
        "archives_on": _iso(o.archives_on),
        "award_floor": o.award_floor,
        "award_ceiling": o.award_ceiling,
        "total_program_funding": o.total_program_funding,
        "expected_award_count": o.expected_award_count,
        "cost_sharing_required": o.cost_sharing_required,
        "eligibility_codes": o.eligibility_codes,
        "category_codes": o.category_codes,
        "funding_instruments": o.funding_instruments,
        "cfda_numbers": o.cfda_numbers,
        "eligibility_note": o.eligibility_note,
    }


def _batched(items: Iterable[Opportunity], size: int) -> Iterator[list[Opportunity]]:
    batch: list[Opportunity] = []
    for item in items:
        batch.append(item)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


class OpportunityLoader:
    def __init__(self, db: Database, *, batch_size: int = BATCH_SIZE) -> None:
        self._db = db
        self._batch_size = batch_size

    async def load(self, opportunities: Iterable[Opportunity]) -> LoadResult:
        """Upsert a stream of opportunities, reporting what changed.

        A failed batch is retried one row at a time. One malformed record in
        83,000 should cost that record, not the 999 loaded beside it, and the
        per-row retry is what turns a failed batch into a logged oddity rather
        than a lost day of data.
        """
        result = LoadResult()

        for batch in _batched(opportunities, self._batch_size):
            payload = json.dumps([_as_json_row(o) for o in batch])
            try:
                rows = await self._db.fetch(_UPSERT, payload)
            except Exception:
                log.exception("batch of %d failed; retrying rows individually", len(batch))
                await self._retry_individually(batch, result)
                continue

            for row in rows:
                if row["was_inserted"]:
                    result.inserted += 1
                else:
                    result.updated += 1

        return result

    async def _retry_individually(self, batch: list[Opportunity], result: LoadResult) -> None:
        for opportunity in batch:
            payload = json.dumps([_as_json_row(opportunity)])
            try:
                rows = await self._db.fetch(_UPSERT, payload)
            except Exception:
                result.failed += 1
                log.warning(
                    "could not load opportunity source=%s uid=%s",
                    opportunity.source,
                    opportunity.source_uid,
                    exc_info=True,
                )
                continue
            for row in rows:
                if row["was_inserted"]:
                    result.inserted += 1
                else:
                    result.updated += 1
