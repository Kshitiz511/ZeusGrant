"""Opportunities, organisation profiles and persisted matches.

All reads that a user can reach are tenant-scoped in SQL rather than filtered in
Python. The catalogue itself is global — 83,394 rows shared by everyone, since a
federal grant is not anybody's private data — but profiles and matches are not,
and the tenant predicate lives in the query so a forgotten argument fails closed
with no rows instead of open with somebody else's.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from zeus_adapters.interfaces import Database

log = logging.getLogger(__name__)

#: Hard ceiling on any page size. A caller asking for 10,000 rows gets 200.
#: Without this a single request can pull the whole open catalogue and hold a
#: connection while it serialises, which is how one careless client degrades
#: the service for everyone.
MAX_PAGE_SIZE = 200


@dataclass(slots=True)
class OrgProfile:
    tenant_id: str
    legal_name: str | None = None
    ein: str | None = None
    applicant_class: str | None = None
    eligibility_codes: list[str] = field(default_factory=list)
    home_state: str | None = None
    operating_states: list[str] = field(default_factory=list)
    mission: str | None = None
    focus_areas: list[str] = field(default_factory=list)
    populations_served: list[str] = field(default_factory=list)
    award_min: float | None = None
    award_max: float | None = None
    annual_budget: float | None = None
    can_cost_share: bool | None = None
    updated_at: datetime | None = None

    @property
    def is_scoreable(self) -> bool:
        """Whether this profile can produce a meaningful ranking.

        Focus areas drive 40 of the 100 points and are the only signal about
        what the organisation actually does. Without them every open grant
        scores the same, so the honest answer is to ask the user to fill them
        in rather than to present an arbitrary order as a recommendation.
        """
        return bool(self.focus_areas)

    @classmethod
    def from_row(cls, row: dict[str, Any]) -> OrgProfile:
        return cls(
            tenant_id=str(row["tenant_id"]),
            legal_name=row.get("legal_name"),
            ein=row.get("ein"),
            applicant_class=row.get("applicant_class"),
            eligibility_codes=list(row.get("eligibility_codes") or []),
            home_state=row.get("home_state"),
            operating_states=list(row.get("operating_states") or []),
            mission=row.get("mission"),
            focus_areas=list(row.get("focus_areas") or []),
            populations_served=list(row.get("populations_served") or []),
            award_min=_as_float(row.get("award_min")),
            award_max=_as_float(row.get("award_max")),
            annual_budget=_as_float(row.get("annual_budget")),
            can_cost_share=row.get("can_cost_share"),
            updated_at=row.get("updated_at"),
        )


def _as_float(value: Any) -> float | None:
    # numeric columns arrive as Decimal, which is not JSON-serialisable and
    # would fail at response encoding rather than here where it is obvious.
    return float(value) if value is not None else None


def _as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


#: The full-text expression, written exactly as it appears in
#: opportunities_fts_idx. There is no stored `search_vector` column -- the index
#: is built on this expression, and Postgres only uses an expression index when
#: the query text matches it character for character. Any drift here silently
#: turns every search into a sequential scan of 83,394 rows.
_FTS = (
    "(setweight(to_tsvector('english', coalesce(o.title, '')), 'A') || "
    "setweight(to_tsvector('english', coalesce(o.description, '')), 'B'))"
)

#: Columns returned for list views. Deliberately excludes `description` and
#: `raw`: descriptions run to several KB each and `raw` holds the entire source
#: record, so selecting them for a 50-row page moves megabytes to render a list
#: that shows neither.
_LIST_COLUMNS = """
    o.id, o.source, o.source_uid, o.source_url, o.title, o.agency_name,
    o.agency_code, o.opportunity_number, o.is_forecast, o.posted_on,
    o.closes_on, o.close_note, o.archives_on, o.award_floor, o.award_ceiling,
    o.total_program_funding, o.expected_award_count, o.cost_sharing_required,
    o.eligibility_codes, o.category_codes, o.funding_instruments,
    o.cfda_numbers, o.is_national, o.eligible_states
"""


class OpportunityRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    # --- catalogue ----------------------------------------------------------

    async def search(
        self,
        *,
        query: str | None = None,
        eligibility_codes: list[str] | None = None,
        agency_code: str | None = None,
        include_forecasts: bool = False,
        closing_within_days: int | None = None,
        min_award: float | None = None,
        max_award: float | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """Full-text and facet search over the open catalogue.

        Every filter is optional and applied as ``($n IS NULL OR ...)`` so one
        statement serves every combination. That keeps the plan cache warm and
        avoids the string-concatenation style of query building, which is where
        injection bugs come from.
        """
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        offset = max(0, offset)

        rows = await self._db.fetch(
            f"""
            SELECT {_LIST_COLUMNS},
                   CASE WHEN $1::text IS NULL THEN 0
                        ELSE ts_rank({_FTS}, websearch_to_tsquery('english', $1), 32)
                   END AS rank
              FROM platform.opportunities o
             WHERE ($1::text IS NULL
                    OR {_FTS} @@ websearch_to_tsquery('english', $1))
               AND ($2::text[] IS NULL OR o.eligibility_codes && $2::text[])
               AND ($3::text IS NULL OR o.agency_code = $3)
               AND ($4::boolean OR NOT o.is_forecast)
               AND (o.closes_on IS NULL OR o.closes_on >= current_date)
               AND (o.archives_on IS NULL OR o.archives_on >= current_date)
               AND ($5::integer IS NULL
                    OR (o.closes_on IS NOT NULL
                        AND o.closes_on <= current_date + $5::integer))
               AND ($6::numeric IS NULL
                    OR o.award_ceiling IS NULL OR o.award_ceiling >= $6::numeric)
               AND ($7::numeric IS NULL
                    OR o.award_floor IS NULL OR o.award_floor <= $7::numeric)
             ORDER BY rank DESC, o.closes_on ASC NULLS LAST, o.id
             LIMIT $8 OFFSET $9
            """,
            query,
            eligibility_codes,
            agency_code,
            include_forecasts,
            closing_within_days,
            min_award,
            max_award,
            limit,
            offset,
        )
        return [_clean(r) for r in rows]

    async def get(self, opportunity_id: str) -> dict[str, Any] | None:
        """One opportunity in full, including the description."""
        row = await self._db.fetch_one(
            f"""
            SELECT {_LIST_COLUMNS}, o.description, o.eligibility_note
              FROM platform.opportunities o
             WHERE o.id = $1::uuid
            """,
            opportunity_id,
        )
        return _clean(row) if row else None

    async def get_by_source_uid(self, source: str, source_uid: str) -> dict[str, Any] | None:
        row = await self._db.fetch_one(
            "SELECT * FROM platform.opportunities WHERE source = $1 AND source_uid = $2",
            source,
            source_uid,
        )
        return _clean(row) if row else None

    async def eligibility_codes(self) -> list[dict[str, Any]]:
        return await self._db.fetch(
            "SELECT code, description, applicant_class FROM platform.eligibility_codes "
            "ORDER BY code"
        )

    async def catalogue_stats(self) -> dict[str, Any]:
        """Headline numbers for the dashboard and for health checks.

        An ingest that silently stops is invisible until someone asks why there
        are no new matches; `last_loaded_at` makes staleness observable.
        """
        row = await self._db.fetch_one(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (
                       WHERE NOT is_forecast
                         AND (closes_on IS NULL OR closes_on >= current_date)
                         AND (archives_on IS NULL OR archives_on >= current_date)
                   ) AS open_now,
                   count(*) FILTER (WHERE is_forecast) AS forecasts,
                   count(*) FILTER (
                       WHERE closes_on IS NULL AND NOT is_forecast
                   ) AS rolling,
                   max(last_seen_at) AS last_loaded_at
              FROM platform.opportunities
            """
        )
        return dict(row or {})

    # --- organisation profile ----------------------------------------------

    async def get_profile(self, tenant_id: str) -> OrgProfile | None:
        row = await self._db.fetch_one(
            "SELECT * FROM platform.org_profiles WHERE tenant_id = $1::uuid", tenant_id
        )
        return OrgProfile.from_row(row) if row else None

    async def upsert_profile(self, tenant_id: str, fields: dict[str, Any]) -> OrgProfile:
        """Create or patch a profile.

        Only keys present in ``fields`` are written; COALESCE on the update path
        means an omitted key keeps its stored value. A partial form submission
        must not blank out everything the user filled in last week.
        """
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.org_profiles (
                tenant_id, legal_name, ein, applicant_class, eligibility_codes,
                home_state, operating_states, mission, focus_areas,
                populations_served, award_min, award_max, annual_budget, can_cost_share
            )
            VALUES (
                $1::uuid, $2, $3, $4, COALESCE($5::text[], '{}'),
                $6, COALESCE($7::text[], '{}'), $8, COALESCE($9::text[], '{}'),
                COALESCE($10::text[], '{}'), $11, $12, $13, $14
            )
            ON CONFLICT (tenant_id) DO UPDATE SET
                legal_name         = COALESCE(EXCLUDED.legal_name, org_profiles.legal_name),
                ein                = COALESCE(EXCLUDED.ein, org_profiles.ein),
                applicant_class    = COALESCE(EXCLUDED.applicant_class,
                                              org_profiles.applicant_class),
                eligibility_codes  = COALESCE($5::text[], org_profiles.eligibility_codes),
                home_state         = COALESCE(EXCLUDED.home_state, org_profiles.home_state),
                operating_states   = COALESCE($7::text[], org_profiles.operating_states),
                mission            = COALESCE(EXCLUDED.mission, org_profiles.mission),
                focus_areas        = COALESCE($9::text[], org_profiles.focus_areas),
                populations_served = COALESCE($10::text[], org_profiles.populations_served),
                award_min          = COALESCE(EXCLUDED.award_min, org_profiles.award_min),
                award_max          = COALESCE(EXCLUDED.award_max, org_profiles.award_max),
                annual_budget      = COALESCE(EXCLUDED.annual_budget,
                                              org_profiles.annual_budget),
                can_cost_share     = COALESCE(EXCLUDED.can_cost_share,
                                              org_profiles.can_cost_share),
                updated_at         = now()
            RETURNING *
            """,
            tenant_id,
            fields.get("legal_name"),
            fields.get("ein"),
            fields.get("applicant_class"),
            fields.get("eligibility_codes"),
            fields.get("home_state"),
            fields.get("operating_states"),
            fields.get("mission"),
            fields.get("focus_areas"),
            fields.get("populations_served"),
            fields.get("award_min"),
            fields.get("award_max"),
            fields.get("annual_budget"),
            fields.get("can_cost_share"),
        )
        assert row is not None  # RETURNING on an upsert always yields a row
        return OrgProfile.from_row(row)

    # --- matches ------------------------------------------------------------

    async def refresh_matches(self, tenant_id: str, *, limit: int = 500) -> int:
        """Rescore this tenant against the catalogue. Returns rows written."""
        row = await self._db.fetch_one(
            "SELECT platform.refresh_matches_for_tenant($1::uuid, $2) AS n",
            tenant_id,
            limit,
        )
        return int((row or {}).get("n") or 0)

    async def list_matches(
        self,
        tenant_id: str,
        *,
        min_score: int = 0,
        include_dismissed: bool = False,
        saved_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(limit, MAX_PAGE_SIZE))
        rows = await self._db.fetch(
            f"""
            SELECT m.id AS match_id, m.score, m.reasons, m.scorer_version,
                   m.saved_at, m.dismissed_at, m.first_seen_at, m.scored_at,
                   {_LIST_COLUMNS}
              FROM platform.opportunity_matches m
              JOIN platform.opportunities o ON o.id = m.opportunity_id
             WHERE m.tenant_id = $1::uuid
               AND m.score >= $2
               AND ($3::boolean OR m.dismissed_at IS NULL)
               AND (NOT $4::boolean OR m.saved_at IS NOT NULL)
               -- A match scored last week against a grant that has since closed
               -- must not still be presented as actionable.
               AND (o.closes_on IS NULL OR o.closes_on >= current_date)
             ORDER BY m.score DESC, o.closes_on ASC NULLS LAST, o.id
             LIMIT $5 OFFSET $6
            """,
            tenant_id,
            min_score,
            include_dismissed,
            saved_only,
            limit,
            max(0, offset),
        )
        return [_clean_match(r) for r in rows]

    async def count_matches(self, tenant_id: str, *, min_score: int = 0) -> int:
        row = await self._db.fetch_one(
            """
            SELECT count(*) AS n
              FROM platform.opportunity_matches m
              JOIN platform.opportunities o ON o.id = m.opportunity_id
             WHERE m.tenant_id = $1::uuid AND m.score >= $2
               AND m.dismissed_at IS NULL
               AND (o.closes_on IS NULL OR o.closes_on >= current_date)
            """,
            tenant_id,
            min_score,
        )
        return int((row or {}).get("n") or 0)

    async def set_match_state(
        self, tenant_id: str, opportunity_id: str, *, saved: bool | None = None,
        dismissed: bool | None = None,
    ) -> dict[str, Any] | None:
        """Save or dismiss a match. Tenant-scoped so ids cannot be probed."""
        row = await self._db.fetch_one(
            """
            UPDATE platform.opportunity_matches
               SET saved_at     = CASE WHEN $3::boolean IS NULL THEN saved_at
                                       WHEN $3 THEN COALESCE(saved_at, now())
                                       ELSE NULL END,
                   dismissed_at = CASE WHEN $4::boolean IS NULL THEN dismissed_at
                                       WHEN $4 THEN COALESCE(dismissed_at, now())
                                       ELSE NULL END
             WHERE tenant_id = $1::uuid AND opportunity_id = $2::uuid
            RETURNING id, score, saved_at, dismissed_at
            """,
            tenant_id,
            opportunity_id,
            saved,
            dismissed,
        )
        return dict(row) if row else None

    async def match_summary(self, tenant_id: str) -> dict[str, Any]:
        row = await self._db.fetch_one(
            """
            SELECT count(*) FILTER (WHERE dismissed_at IS NULL) AS active,
                   count(*) FILTER (WHERE saved_at IS NOT NULL) AS saved,
                   count(*) FILTER (WHERE dismissed_at IS NOT NULL) AS dismissed,
                   count(*) FILTER (WHERE dismissed_at IS NULL AND score >= 70) AS strong,
                   max(scored_at) AS last_scored_at
              FROM platform.opportunity_matches
             WHERE tenant_id = $1::uuid
            """,
            tenant_id,
        )
        return dict(row or {})


def _clean(row: dict[str, Any] | None) -> dict[str, Any]:
    """Normalise a catalogue row for JSON encoding."""
    if row is None:
        return {}
    out = dict(row)
    for key in ("id", "tenant_id", "opportunity_id"):
        if out.get(key) is not None:
            out[key] = str(out[key])
    for key in ("award_floor", "award_ceiling", "total_program_funding"):
        if key in out:
            out[key] = _as_float(out[key])
    for key in (
        "eligibility_codes", "category_codes", "funding_instruments",
        "cfda_numbers", "eligible_states",
    ):
        if key in out:
            out[key] = list(out[key] or [])
    for key in ("posted_on", "closes_on", "archives_on"):
        value = out.get(key)
        if isinstance(value, date):
            out[key] = value.isoformat()
    out.pop("rank", None)
    out.pop("search_vector", None)
    out.pop("raw", None)
    return out


def _clean_match(row: dict[str, Any]) -> dict[str, Any]:
    out = _clean(row)
    out["match_id"] = str(row["match_id"])
    out["reasons"] = _as_list(row.get("reasons"))
    return out
