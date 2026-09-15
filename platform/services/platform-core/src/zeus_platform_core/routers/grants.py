"""Grant intelligence endpoints.

Every route is tenant-scoped through the existing security dependencies. The
catalogue is readable by any authenticated tenant because a federal grant is
public information; matches and profiles are not, and those queries carry the
tenant predicate in SQL rather than filtering after the fact.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from zeus_platform_core.security import ContainerDep, SessionDep, TenantIdDep
from zeus_platform_core.services.grant_service import LimitExceeded, ProfileIncomplete

log = logging.getLogger(__name__)

router = APIRouter(prefix="/grants", tags=["grants"])


# --- models ------------------------------------------------------------------

class ProfileIn(BaseModel):
    """Profile patch. Every field optional; omitted fields keep their value."""

    legal_name: str | None = None
    ein: str | None = None
    applicant_class: str | None = None
    eligibility_codes: list[str] | None = None
    home_state: str | None = None
    operating_states: list[str] | None = None
    mission: str | None = Field(default=None, max_length=4000)
    focus_areas: list[str] | None = None
    populations_served: list[str] | None = None
    award_min: float | None = Field(default=None, ge=0)
    award_max: float | None = Field(default=None, ge=0)
    annual_budget: float | None = Field(default=None, ge=0)
    can_cost_share: bool | None = None

    @field_validator("home_state")
    @classmethod
    def _upper_state(cls, v: str | None) -> str | None:
        # The column has a CHECK for two uppercase letters. Normalising here
        # turns "ca" into a save rather than a 500 from a constraint violation.
        return v.upper().strip() if v else v

    @field_validator("operating_states")
    @classmethod
    def _upper_states(cls, v: list[str] | None) -> list[str] | None:
        return [s.upper().strip() for s in v if s.strip()] if v is not None else None

    @field_validator("focus_areas", "populations_served", "eligibility_codes")
    @classmethod
    def _clean_list(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return None
        # Cap the length: focus areas feed a tsquery, and a thousand terms
        # would build a query that takes longer than the search it serves.
        cleaned = [s.strip() for s in v if s and s.strip()]
        return cleaned[:50]


class ProfileOut(BaseModel):
    tenant_id: str
    legal_name: str | None = None
    ein: str | None = None
    applicant_class: str | None = None
    eligibility_codes: list[str] = []
    home_state: str | None = None
    operating_states: list[str] = []
    mission: str | None = None
    focus_areas: list[str] = []
    populations_served: list[str] = []
    award_min: float | None = None
    award_max: float | None = None
    annual_budget: float | None = None
    can_cost_share: bool | None = None
    is_scoreable: bool = False


class MatchStateIn(BaseModel):
    saved: bool | None = None
    dismissed: bool | None = None


# --- catalogue ---------------------------------------------------------------

@router.get("/opportunities")
async def search_opportunities(
    container: ContainerDep,
    _session: SessionDep,
    q: Annotated[str | None, Query(max_length=200)] = None,
    eligibility_code: Annotated[list[str] | None, Query()] = None,
    agency_code: Annotated[str | None, Query(max_length=32)] = None,
    include_forecasts: bool = False,
    closing_within_days: Annotated[int | None, Query(ge=1, le=365)] = None,
    min_award: Annotated[float | None, Query(ge=0)] = None,
    max_award: Annotated[float | None, Query(ge=0)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> dict[str, Any]:
    """Search the open catalogue. Public to any signed-in tenant."""
    rows = await container.grants.search(
        query=q,
        eligibility_codes=eligibility_code,
        agency_code=agency_code,
        include_forecasts=include_forecasts,
        closing_within_days=closing_within_days,
        min_award=min_award,
        max_award=max_award,
        limit=limit,
        offset=offset,
    )
    return {"opportunities": rows, "count": len(rows), "offset": offset}


@router.get("/opportunities/{opportunity_id}")
async def get_opportunity(
    opportunity_id: str, container: ContainerDep, _session: SessionDep
) -> dict[str, Any]:
    row = await container.grants.get_opportunity(opportunity_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Opportunity not found.")
    return row


@router.get("/eligibility-codes")
async def eligibility_codes(container: ContainerDep, _session: SessionDep) -> dict[str, Any]:
    """The 17 applicant-type codes, for building profile forms."""
    return {"codes": await container.grants.eligibility_codes()}


@router.get("/stats")
async def catalogue_stats(container: ContainerDep, _session: SessionDep) -> dict[str, Any]:
    return await container.grants.catalogue_stats()


# --- profile -----------------------------------------------------------------

@router.get("/profile", response_model=ProfileOut | None)
async def get_profile(container: ContainerDep, tenant_id: TenantIdDep) -> ProfileOut | None:
    profile = await container.grants.get_profile(tenant_id)
    if profile is None:
        return None
    return _profile_out(profile)


@router.put("/profile", response_model=ProfileOut)
async def save_profile(
    body: ProfileIn, container: ContainerDep, tenant_id: TenantIdDep
) -> ProfileOut:
    # exclude_unset, not exclude_none: the two differ for a field the caller
    # explicitly set to null, which means "clear this" rather than "leave it".
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No fields to update.")
    profile = await container.grants.save_profile(tenant_id, fields)
    return _profile_out(profile)


def _profile_out(profile: Any) -> ProfileOut:
    """Convert an OrgProfile to its response model.

    asdict rather than vars(): OrgProfile is a slots dataclass, so it has no
    __dict__ and vars() raises. `updated_at` is dropped because ProfileOut does
    not declare it, and is_scoreable is computed rather than stored.
    """
    data = asdict(profile)
    data.pop("updated_at", None)
    return ProfileOut(**data, is_scoreable=profile.is_scoreable)


# --- matches -----------------------------------------------------------------

@router.get("/matches")
async def list_matches(
    container: ContainerDep,
    tenant_id: TenantIdDep,
    min_score: Annotated[int, Query(ge=0, le=100)] = 0,
    saved_only: bool = False,
    include_dismissed: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> dict[str, Any]:
    return await container.grants.list_matches(
        tenant_id,
        min_score=min_score,
        saved_only=saved_only,
        include_dismissed=include_dismissed,
        limit=limit,
        offset=offset,
    )


@router.get("/matches/summary")
async def match_summary(container: ContainerDep, tenant_id: TenantIdDep) -> dict[str, Any]:
    return await container.grants.match_summary(tenant_id)


@router.post("/matches/{opportunity_id}/state")
async def set_match_state(
    opportunity_id: str,
    body: MatchStateIn,
    container: ContainerDep,
    tenant_id: TenantIdDep,
) -> dict[str, Any]:
    if body.saved is None and body.dismissed is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nothing to change.")
    row = await container.grants.set_match_state(
        tenant_id, opportunity_id, saved=body.saved, dismissed=body.dismissed
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found for this tenant.")
    return row


# --- scans -------------------------------------------------------------------

@router.post("/scan", status_code=status.HTTP_202_ACCEPTED)
async def request_scan(container: ContainerDep, tenant_id: TenantIdDep) -> dict[str, Any]:
    """Queue a rescore. 202 because the work has not happened yet.

    Returns a job id to poll. The legacy version returned a toast claiming new
    matches had been found, having done nothing but count rows.
    """
    try:
        result = await container.grants.request_scan(tenant_id)
    except ProfileIncomplete as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"error": "profile_incomplete", "message": str(exc)},
        ) from exc
    except LimitExceeded as exc:
        # 402, not 403: this is not a permission failure, it is a plan ceiling,
        # and the client should offer an upgrade rather than an error page.
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "limit_exceeded",
                "message": str(exc),
                "limit": exc.limit,
                "used": exc.used,
                "resets_at": exc.resets_at,
            },
        ) from exc

    return {
        "job_id": result.job_id,
        "status": result.status,
        "already_running": not result.queued,
        "scans_used": result.scans_used,
        "scans_limit": result.scans_limit,
    }


@router.get("/scan/{job_id}")
async def scan_status(
    job_id: str, container: ContainerDep, tenant_id: TenantIdDep
) -> dict[str, Any]:
    row = await container.grants.job_status(tenant_id, job_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found.")
    return row


@router.get("/usage")
async def scan_usage(container: ContainerDep, tenant_id: TenantIdDep) -> dict[str, Any]:
    """What the plan allows and how much is left, from the server's own count."""
    return await container.grants.scan_usage(tenant_id)


# --- worker trigger ----------------------------------------------------------

@router.post("/worker/run", include_in_schema=False)
async def run_worker(
    container: ContainerDep,
    secret: Annotated[str, Body(embed=True)],
    max_jobs: Annotated[int, Body(embed=True)] = 5,
) -> dict[str, Any]:
    """Drain a few jobs. For serverless deployments with no long-lived worker.

    Authenticated by a shared secret rather than a user session: the caller is
    a scheduler, not a person. Compared in constant time so the endpoint cannot
    be used as an oracle to recover the secret byte by byte.
    """
    import hmac

    expected = container.settings.worker_secret
    if not expected:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No worker secret configured; the HTTP worker is disabled.",
        )
    if not hmac.compare_digest(secret, expected.get_secret_value()):
        log.warning("worker.bad_secret")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid worker secret.")

    worker = container.build_worker()
    # Bounded well inside the 60-second function limit so the last job can
    # finish and be recorded rather than being killed mid-write.
    return await worker.drain(max_jobs=max_jobs, max_seconds=45.0)
