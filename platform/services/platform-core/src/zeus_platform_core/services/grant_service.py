"""Grant intelligence service: profile, search, matches, and plan limits.

Plan limits are enforced here, on the server, against a counter the server
writes. The legacy application sliced limits in the browser and let the client
POST its own usage figure, so a user could reset their own cap by editing a
request. Anything the client sends about its own entitlements is a suggestion.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from zeus_service_kit.jobs import JobRepository

from zeus_platform_core.repositories.opportunities import OpportunityRepository, OrgProfile

log = logging.getLogger(__name__)

#: Must match the module id used by the database, the job ledger and the
#: entitlement claims. It read "grant-intelligence" with a hyphen until 0014,
#: so every limit lookup missed and the service silently used the defaults
#: below -- a plan could not raise or lower anything about Grant Intelligence.
MODULE_ID = "grant_intelligence"

#: Limit keys read from the plan's entitlements.
LIMIT_SCANS_PER_MONTH = "scans_per_month"
LIMIT_MATCHES_VISIBLE = "matches_visible"

#: Used only when the tenant has no active Grant Intelligence entitlement, or
#: when entitlements cannot be read at all. It is **not** what a plan omitting
#: the key means: under DEC-10 an absent or NULL limit row is unlimited, which
#: is exactly how every ``*_enterprise`` plan is configured. Treating a gap as
#: the free tier gave the most expensive plans the smallest allowance (D22).
DEFAULT_SCANS_PER_MONTH = 3
DEFAULT_MATCHES_VISIBLE = 25

#: How many matches to serve when the plan says unlimited. A window still has
#: to end somewhere -- the alternative is an unbounded query -- but this is a
#: pagination ceiling, not an entitlement, and it is far above any real page.
UNLIMITED_MATCHES_WINDOW = 10_000


class LimitExceeded(Exception):
    def __init__(self, message: str, *, limit: int, used: int, resets_at: str | None = None):
        super().__init__(message)
        self.limit = limit
        self.used = used
        self.resets_at = resets_at


class ProfileIncomplete(Exception):
    """Raised when scoring is requested but the profile cannot produce one."""


@dataclass(slots=True)
class ScanResult:
    job_id: str
    status: str
    queued: bool
    scans_used: int
    #: None when the plan states no ceiling.
    scans_limit: int | None


class GrantService:
    def __init__(
        self,
        *,
        opportunities: OpportunityRepository,
        jobs: JobRepository,
        entitlements: Any,
        db: Any,
    ) -> None:
        self._repo = opportunities
        self._jobs = jobs
        self._entitlements = entitlements
        self._db = db

    # --- profile ------------------------------------------------------------

    async def get_profile(self, tenant_id: str) -> OrgProfile | None:
        return await self._repo.get_profile(tenant_id)

    async def save_profile(self, tenant_id: str, fields: dict[str, Any]) -> OrgProfile:
        """Persist profile edits and queue a rescore if the scoring inputs moved.

        Only the fields that actually affect a score trigger a rescore. Renaming
        the organisation changes nothing about which grants fit it, and queuing
        900 rows of work for a typo fix is waste.
        """
        scoring_inputs = {
            "eligibility_codes", "focus_areas", "home_state", "operating_states",
            "award_min", "award_max", "can_cost_share",
        }
        touched_scoring = bool(scoring_inputs & set(fields))

        profile = await self._repo.upsert_profile(tenant_id, fields)

        if touched_scoring and profile.is_scoreable:
            # Minute-stamped key so rapid edits collapse into one rescore rather
            # than queueing a job per keystroke in an autosaving form.
            stamp = datetime.now(UTC).strftime("%Y%m%d%H%M")
            await self._jobs.enqueue(
                "matching.rescore_tenant",
                tenant_id=tenant_id,
                idempotency_key=f"profile-rescore:{tenant_id}:{stamp}",
                priority=50,
            )
        return profile

    # --- catalogue ----------------------------------------------------------

    async def search(self, **kwargs: Any) -> list[dict[str, Any]]:
        return await self._repo.search(**kwargs)

    async def get_opportunity(self, opportunity_id: str) -> dict[str, Any] | None:
        return await self._repo.get(opportunity_id)

    async def eligibility_codes(self) -> list[dict[str, Any]]:
        return await self._repo.eligibility_codes()

    async def catalogue_stats(self) -> dict[str, Any]:
        return await self._repo.catalogue_stats()

    # --- matches ------------------------------------------------------------

    async def list_matches(
        self, tenant_id: str, *, limit: int = 50, offset: int = 0, **kwargs: Any
    ) -> dict[str, Any]:
        """Matches for a tenant, truncated to what the plan allows.

        The cap is applied to the window, not just the page: a free-tier user
        paging past their allowance gets nothing, rather than page 1 being
        capped and page 2 quietly serving the rest.
        """
        visible = await self._limit(tenant_id, LIMIT_MATCHES_VISIBLE, DEFAULT_MATCHES_VISIBLE)
        # A window still has to end somewhere, but an unlimited plan must not
        # be *reported* as capped at the window -- the UI would say "showing
        # 312 of 312 (limited)" on a plan that has no limit.
        window = UNLIMITED_MATCHES_WINDOW if visible is None else visible

        remaining = max(0, window - offset)
        effective_limit = min(limit, remaining)
        if effective_limit == 0:
            rows: list[dict[str, Any]] = []
        else:
            rows = await self._repo.list_matches(
                tenant_id, limit=effective_limit, offset=offset, **kwargs
            )

        total = await self._repo.count_matches(tenant_id)
        return {
            "matches": rows,
            "total": total,
            # Stated plainly so the UI can say "showing 25 of 312" rather than
            # pretending 25 is all there is. ``None`` means unlimited.
            "visible_limit": visible,
            "truncated": visible is not None and total > visible,
            "offset": offset,
        }

    async def match_summary(self, tenant_id: str) -> dict[str, Any]:
        summary = await self._repo.match_summary(tenant_id)
        summary["scans"] = await self.scan_usage(tenant_id)
        return summary

    async def set_match_state(
        self, tenant_id: str, opportunity_id: str, **kwargs: Any
    ) -> dict[str, Any] | None:
        return await self._repo.set_match_state(tenant_id, opportunity_id, **kwargs)

    # --- scans --------------------------------------------------------------

    async def scan_usage(self, tenant_id: str) -> dict[str, Any]:
        used = await self._scans_this_month(tenant_id)
        limit = await self._limit(tenant_id, LIMIT_SCANS_PER_MONTH, DEFAULT_SCANS_PER_MONTH)
        # ``None`` for both means unlimited. Reporting remaining=0 there would
        # make the UI grey out the button on the plan that paid for it.
        remaining = None if limit is None else max(0, limit - used)
        return {"used": used, "limit": limit, "remaining": remaining}

    async def request_scan(self, tenant_id: str) -> ScanResult:
        """Queue a rescore for this tenant, subject to the plan's scan limit.

        A "scan" in the legacy app was ``SELECT count(*)`` followed by a toast
        claiming new matches had been found; the count was set equal to the
        total by construction, so it always claimed everything was new. Here it
        queues real work and returns a job the caller can poll.
        """
        profile = await self._repo.get_profile(tenant_id)
        if profile is None or not profile.is_scoreable:
            raise ProfileIncomplete(
                "Add at least one focus area to your organisation profile "
                "before running a scan."
            )

        used = await self._scans_this_month(tenant_id)
        limit = await self._limit(tenant_id, LIMIT_SCANS_PER_MONTH, DEFAULT_SCANS_PER_MONTH)
        if limit is not None and used >= limit:
            raise LimitExceeded(
                f"You have used all {limit} scans on your plan this month.",
                limit=limit,
                used=used,
                resets_at=_next_month_start().isoformat(),
            )

        # Idempotency is per minute, not per scan: a double-clicked button must
        # not consume two of three monthly scans. The returned job is the
        # existing one, so the UI still gets something to poll.
        stamp = datetime.now(UTC).strftime("%Y%m%d%H%M")
        job = await self._jobs.enqueue(
            "matching.rescore_tenant",
            tenant_id=tenant_id,
            idempotency_key=f"scan:{tenant_id}:{stamp}",
            priority=10,  # user is waiting: ahead of every scheduled job
        )
        queued = job.status == "queued" and job.attempts == 0

        return ScanResult(
            job_id=job.id,
            status=job.status,
            queued=queued,
            scans_used=used + 1,
            scans_limit=limit,
        )

    async def job_status(self, tenant_id: str, job_id: str) -> dict[str, Any] | None:
        # Tenant-scoped: without it, any authenticated user could poll any job
        # id and read another tenant's payload.
        job = await self._jobs.get(job_id, tenant_id=tenant_id)
        if job is None:
            return None
        return {
            "id": job.id,
            "kind": job.kind,
            "status": job.status,
            "attempts": job.attempts,
            "progress_done": job.progress_done,
            "progress_total": job.progress_total,
            "result": job.result,
            # The raw error holds a traceback. Users get the fact of failure;
            # the detail stays in the logs where it belongs.
            "error": "The scan could not be completed." if job.last_error else None,
        }

    # --- internals ----------------------------------------------------------

    async def _scans_this_month(self, tenant_id: str) -> int:
        """Count scans from the job ledger rather than a usage counter.

        The ledger is the record of what actually ran, so the count cannot
        drift from reality and there is no separate counter for a client to
        write to. Cancelled and failed jobs are excluded -- charging someone a
        scan for work that errored is indefensible.
        """
        row = await self._db.fetch_one(
            """
            SELECT count(*) AS n
              FROM platform.jobs
             WHERE tenant_id = $1::uuid
               AND kind = 'matching.rescore_tenant'
               AND idempotency_key LIKE 'scan:%'
               AND status <> 'cancelled'
               AND NOT (status = 'failed' AND attempts >= max_attempts)
               AND created_at >= date_trunc('month', now())
            """,
            tenant_id,
        )
        return int((row or {}).get("n") or 0)

    async def _limit(self, tenant_id: str, key: str, default: int) -> int | None:
        """Read a numeric limit from the tenant's entitlements.

        ``None`` means unlimited and callers must handle it. Returning the
        default for it instead -- which this did until D22 -- silently caps an
        enterprise tenant at the free-tier number.
        """
        try:
            claims = await self._entitlements.get_claims(tenant_id)
        except Exception:
            # Entitlements unavailable. Fall back to the default rather than
            # failing open to unlimited or closed to zero.
            log.warning("grants.entitlements_unavailable tenant=%s", tenant_id, exc_info=True)
            return default
        value = claims.limit_ceiling(MODULE_ID, key, fallback=default)
        return None if value is None else int(value)


def _next_month_start() -> datetime:
    now = datetime.now(UTC)
    year, month = (now.year + 1, 1) if now.month == 12 else (now.year, now.month + 1)
    return datetime(year, month, 1, tzinfo=UTC)
