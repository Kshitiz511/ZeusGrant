"""MCP server exposing grant intelligence as deterministic tools.

Every tool here is a database query. None of them calls a model. That is the
whole point of the split: an agent that needs to know which grants are open
asks this server and gets the actual answer, rather than recalling something
plausible from training data. The model's job is to decide which tool to call
and how to phrase the result, never to supply the facts.

Practical consequences of that rule:

  * Results are reproducible. Two identical calls return identical data, so a
    disagreement between them is a data change, not model temperature.
  * Results are auditable. Every number a user sees traces to a row.
  * Results are cheap. A search is a millisecond and costs nothing per call,
    so an agent can look things up as often as it needs to.

Transport is stdio, which is what MCP clients expect for a local server. The
database pool is opened once at startup and shared; opening a connection per
tool call would make a five-call conversation twenty times more expensive than
the queries themselves.
"""

from __future__ import annotations

import logging
import os
from typing import Any

log = logging.getLogger(__name__)

#: Tool results are capped well below the repository's own limit. An MCP result
#: is fed into a model's context, and 200 full opportunity records would consume
#: a large fraction of the window while being no more useful than 20 good ones.
MAX_TOOL_ROWS = 25


def _summarise(row: dict[str, Any]) -> dict[str, Any]:
    """Trim a catalogue row to what a model can actually use.

    Dropping fields is not cosmetic. Source UUIDs, array columns of internal
    codes and null-heavy metadata add tokens without adding meaning, and a
    model given 40 fields will pick something irrelevant to talk about.
    """
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "agency": row.get("agency_name"),
        "number": row.get("opportunity_number"),
        "closes_on": row.get("closes_on"),
        "is_rolling": row.get("closes_on") is None,
        "award_floor": row.get("award_floor"),
        "award_ceiling": row.get("award_ceiling"),
        "cost_sharing_required": row.get("cost_sharing_required"),
        "eligibility_codes": row.get("eligibility_codes"),
        "url": row.get("source_url"),
    }


def build_server():  # noqa: C901 - a flat list of tool definitions
    """Construct the MCP server.

    Imports are deferred so importing this module (for tests, or for the tool
    inventory) does not require the MCP package to be installed in a deployment
    that never runs the server.
    """
    # MCP 2.x renamed FastMCP to MCPServer. Import the new name first and fall
    # back to the old one, so this works against either major version rather
    # than pinning the SDK to whatever happened to be installed on the day.
    try:
        from mcp.server.mcpserver import MCPServer as _Server
    except ImportError:  # pragma: no cover - mcp 1.x
        from mcp.server.fastmcp import FastMCP as _Server

    from zeus_platform_core.container import Container

    mcp = _Server("zeus-grants")
    container = Container()
    _started = False

    async def repo():
        nonlocal _started
        if not _started:
            await container.db.connect()
            _started = True
        return container.opportunities

    @mcp.tool()
    async def search_opportunities(
        query: str | None = None,
        eligibility_codes: list[str] | None = None,
        agency_code: str | None = None,
        closing_within_days: int | None = None,
        min_award: float | None = None,
        max_award: float | None = None,
        limit: int = 10,
    ) -> dict[str, Any]:
        """Search open federal funding opportunities.

        Only returns opportunities that are currently open -- closed and
        archived records are excluded at the database, so anything returned can
        still be applied for today.

        Args:
            query: Free text, matched against title and description.
            eligibility_codes: Applicant type codes; use list_eligibility_codes
                to see them. Code 25 means eligibility is described in prose.
            agency_code: Restrict to one agency.
            closing_within_days: Only grants closing inside this many days.
            min_award: Exclude grants whose ceiling is below this.
            max_award: Exclude grants whose floor is above this.
            limit: Maximum rows, capped at 25.
        """
        r = await repo()
        rows = await r.search(
            query=query,
            eligibility_codes=eligibility_codes,
            agency_code=agency_code,
            closing_within_days=closing_within_days,
            min_award=min_award,
            max_award=max_award,
            limit=min(limit, MAX_TOOL_ROWS),
        )
        return {
            "count": len(rows),
            "opportunities": [_summarise(x) for x in rows],
            # Stated explicitly so a model does not report a capped page as the
            # complete set, which is how "there are only 10 grants" gets said
            # about a catalogue of 895.
            "truncated": len(rows) == min(limit, MAX_TOOL_ROWS),
        }

    @mcp.tool()
    async def get_opportunity(opportunity_id: str) -> dict[str, Any]:
        """Fetch one opportunity in full, including its description and the
        eligibility prose that applicant-type codes do not capture."""
        r = await repo()
        row = await r.get(opportunity_id)
        if row is None:
            return {"error": "not_found", "opportunity_id": opportunity_id}
        out = _summarise(row)
        out["description"] = (row.get("description") or "")[:6000]
        out["eligibility_note"] = row.get("eligibility_note")
        return out

    @mcp.tool()
    async def list_eligibility_codes() -> dict[str, Any]:
        """The 17 applicant-type codes used across the catalogue.

        Worth reading before filtering: code 25, "Others (see text field)", is
        the single most common code in the catalogue, so filtering it out
        discards a large share of genuinely eligible opportunities.
        """
        r = await repo()
        return {"codes": await r.eligibility_codes()}

    @mcp.tool()
    async def score_for_tenant(tenant_id: str, limit: int = 10) -> dict[str, Any]:
        """Return this organisation's ranked matches with scoring reasons.

        Scores are computed by a deterministic SQL rule set, not by a model.
        Each match carries the four factors that produced its score, so the
        number can be explained rather than asserted.
        """
        r = await repo()
        profile = await r.get_profile(tenant_id)
        if profile is None:
            return {"error": "no_profile", "tenant_id": tenant_id}
        if not profile.is_scoreable:
            return {
                "error": "profile_incomplete",
                "message": "The organisation profile has no focus areas, so "
                           "matches cannot be ranked meaningfully.",
            }

        rows = await r.list_matches(tenant_id, limit=min(limit, MAX_TOOL_ROWS))
        return {
            "count": len(rows),
            "matches": [
                _summarise(x) | {"score": x["score"], "reasons": x["reasons"]}
                for x in rows
            ],
        }

    @mcp.tool()
    async def get_org_profile(tenant_id: str) -> dict[str, Any]:
        """Read an organisation's funding profile: what it does, who it serves,
        what it is eligible for and what size of award it can absorb."""
        r = await repo()
        profile = await r.get_profile(tenant_id)
        if profile is None:
            return {"error": "no_profile", "tenant_id": tenant_id}
        return {
            "legal_name": profile.legal_name,
            "applicant_class": profile.applicant_class,
            "eligibility_codes": profile.eligibility_codes,
            "home_state": profile.home_state,
            "operating_states": profile.operating_states,
            "mission": profile.mission,
            "focus_areas": profile.focus_areas,
            "populations_served": profile.populations_served,
            "award_range": [profile.award_min, profile.award_max],
            "can_cost_share": profile.can_cost_share,
            "is_scoreable": profile.is_scoreable,
        }

    @mcp.tool()
    async def catalogue_stats() -> dict[str, Any]:
        """Size and freshness of the catalogue.

        Check `last_loaded_at` before trusting a search: a stale catalogue
        returns confident answers about a world that has moved on.
        """
        r = await repo()
        stats = await r.catalogue_stats()
        return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in stats.items()}

    return mcp


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("ZEUS_LOG_LEVEL", "INFO"),
        # stderr, never stdout: stdout is the MCP protocol channel, and a log
        # line written there corrupts the message stream and drops the session.
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    build_server().run(transport="stdio")


if __name__ == "__main__":
    main()
