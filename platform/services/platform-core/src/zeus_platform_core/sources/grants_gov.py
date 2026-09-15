"""Parse the Grants.gov daily XML extract into opportunity records.

The extract is a single 306 MB XML document holding ~83,000 records. It is
streamed with iterparse and each element is cleared after use, so memory stays
flat regardless of file size; loading it into a DOM would need several GB.

Namespace note, learned the hard way: the document declares
``xmlns="http://apply.grants.gov/system/OpportunityDetail-V1.0"`` but its
``schemaLocation`` points at ``apply07.grants.gov``. Matching on the namespace
URI from the schemaLocation returns zero records with no error. Everything here
matches on the local tag name instead.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

log = logging.getLogger(__name__)

SOURCE = "grants.gov"

# The two record types in the extract. Forecasts are announcements of grants
# that do not exist yet, with estimated dates and often no award amounts.
_SYNOPSIS_TAG = "OpportunitySynopsisDetail_1_0"
_FORECAST_TAG = "OpportunityForecastDetail_1_0"

# Elements that may appear more than once per record and must be collected
# into a list rather than overwritten.
_REPEATED = {
    "EligibleApplicants",
    "CategoryOfFundingActivity",
    "FundingInstrumentType",
    "CFDANumbers",
}


@dataclass(slots=True)
class Opportunity:
    """One funding opportunity, shaped for the database."""

    source_uid: str
    title: str
    is_forecast: bool
    source: str = SOURCE
    source_url: str | None = None
    description: str | None = None
    agency_name: str | None = None
    agency_code: str | None = None
    opportunity_number: str | None = None
    posted_on: date | None = None
    closes_on: date | None = None
    close_note: str | None = None
    archives_on: date | None = None
    award_floor: float | None = None
    award_ceiling: float | None = None
    total_program_funding: float | None = None
    expected_award_count: int | None = None
    cost_sharing_required: bool | None = None
    eligibility_codes: list[str] = field(default_factory=list)
    category_codes: list[str] = field(default_factory=list)
    funding_instruments: list[str] = field(default_factory=list)
    cfda_numbers: list[str] = field(default_factory=list)
    eligibility_note: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_date(value: str | None) -> date | None:
    """Grants.gov ships dates as MMDDYYYY with no separators.

    Bad dates are dropped rather than raised on. A single malformed date in
    83,000 records should not abort a load; the row is still useful without it,
    and a missing close date already has a defined meaning.
    """
    if not value:
        return None
    try:
        return datetime.strptime(value.strip(), "%m%d%Y").date()
    except ValueError:
        return None


def _parse_number(value: str | None) -> float | None:
    if not value:
        return None
    # Some amounts carry commas or a currency symbol.
    cleaned = value.strip().replace(",", "").replace("$", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_int(value: str | None) -> int | None:
    n = _parse_number(value)
    return int(n) if n is not None else None


def _parse_bool(value: str | None) -> bool | None:
    """Cost sharing arrives as 'Yes'/'No'.

    Returns None for anything else: "we do not know" and "no" lead to
    different advice, so they must not collapse into the same value.
    """
    if not value:
        return None
    v = value.strip().lower()
    if v in ("yes", "y", "true", "1"):
        return True
    if v in ("no", "n", "false", "0"):
        return False
    return None


def _build(fields: dict[str, Any], is_forecast: bool) -> Opportunity | None:
    uid = fields.get("OpportunityID")
    title = fields.get("OpportunityTitle")
    # Without an identifier there is nothing to upsert on, and without a title
    # there is nothing to show. Either way the row is unusable.
    if not uid or not title:
        return None

    # Forecasts use Estimated* date fields; synopses use the plain ones.
    closes_on = _parse_date(fields.get("CloseDate")) or _parse_date(
        fields.get("EstimatedSynopsisCloseDate")
    )
    posted_on = _parse_date(fields.get("PostDate")) or _parse_date(
        fields.get("EstimatedSynopsisPostDate")
    )

    # A close date before the post date fails the database check constraint.
    # It happens in the archive, where a record was revised after closing.
    # Dropping the close date keeps the row rather than failing the batch.
    if closes_on and posted_on and closes_on < posted_on:
        log.debug("opportunity %s closes before it posts; dropping close date", uid)
        closes_on = None

    floor = _parse_number(fields.get("AwardFloor"))
    ceiling = _parse_number(fields.get("AwardCeiling"))
    # Same reasoning: a floor above the ceiling is a data error at the source,
    # not a reason to lose the opportunity.
    if floor is not None and ceiling is not None and ceiling < floor:
        floor, ceiling = None, None

    return Opportunity(
        source_uid=str(uid),
        title=str(title)[:500],
        is_forecast=is_forecast,
        source_url=f"https://www.grants.gov/search-results-detail/{uid}",
        description=fields.get("Description"),
        agency_name=fields.get("AgencyName"),
        agency_code=fields.get("AgencyCode"),
        opportunity_number=fields.get("OpportunityNumber"),
        posted_on=posted_on,
        closes_on=closes_on,
        close_note=fields.get("CloseDateExplanation")
        or fields.get("EstimatedSynopsisCloseDateExplanation"),
        archives_on=_parse_date(fields.get("ArchiveDate")),
        award_floor=floor,
        award_ceiling=ceiling,
        total_program_funding=_parse_number(fields.get("EstimatedTotalProgramFunding")),
        expected_award_count=_parse_int(fields.get("ExpectedNumberOfAwards")),
        cost_sharing_required=_parse_bool(fields.get("CostSharingOrMatchingRequirement")),
        eligibility_codes=list(fields.get("EligibleApplicants", [])),
        category_codes=list(fields.get("CategoryOfFundingActivity", [])),
        funding_instruments=list(fields.get("FundingInstrumentType", [])),
        cfda_numbers=list(fields.get("CFDANumbers", [])),
        eligibility_note=fields.get("AdditionalInformationOnEligibility"),
        raw={},
    )


def parse(path: str | Path) -> Iterator[Opportunity]:
    """Yield opportunities from the extract, one at a time.

    A generator rather than a list: the caller batches these into the database,
    and materialising 83,000 dataclasses at once defeats the point of streaming
    the file.
    """
    skipped = 0
    for _event, elem in ET.iterparse(str(path), events=("end",)):
        tag = _local(elem.tag)
        if tag not in (_SYNOPSIS_TAG, _FORECAST_TAG):
            continue

        fields: dict[str, Any] = {}
        for child in elem:
            key = _local(child.tag)
            value = (child.text or "").strip()
            if not value:
                continue
            if key in _REPEATED:
                fields.setdefault(key, []).append(value)
            else:
                fields[key] = value

        record = _build(fields, is_forecast=(tag == _FORECAST_TAG))

        # Free the element and its children. Without this the parser retains
        # the whole document and the process grows to several GB.
        elem.clear()

        if record is None:
            skipped += 1
            continue
        yield record

    if skipped:
        log.warning("skipped %d records with no id or title", skipped)
