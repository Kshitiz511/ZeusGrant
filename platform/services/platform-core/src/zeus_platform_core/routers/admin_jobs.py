"""Platform-admin view of the job ledger: see what is stuck, and act on it.

Until now the ledger has been write-only from an operator's point of view.
Machines enqueue, claim, finish and retry; no human could look at a job, stop
one, or give a failed one another chance. When something went wrong the only
recourse was a psql session against production.

Four ideas shape this router:

**Reads are cross-module, and that is the exception, not the rule.** Every
service's own :class:`JobRepository` is bound to one ``module_id`` so it cannot
see another's work. That isolation is what keeps the services independently
sellable and it stays intact; this router uses a separate repository that the
admin surface alone can reach, guarded by ``AdminDep``.

**The list is safe to read, the detail is not.** Job payloads and results hold
tenant data -- document text, organisation profiles, model output. The list
returns neither, so an operator scanning for failures is not casually reading
customer content. Opening one job returns everything and is audited, because
that is a deliberate act with a reason behind it.

**Cancel actually stops the work.** Setting the status alone would relabel a job
while it kept running and kept spending. Clearing the lease means the handler's
next heartbeat is rejected, ``ctx.progress`` raises ``JobLost``, and the worker
abandons it without consuming a retry. Handlers with progress loops -- every
expensive one -- stop at their next checkpoint; the rest stop at the worker's
90-second keepalive.

**Health observes and never mutates.** The reaper is a separate, audited action.
An endpoint that repaired the thing it reported on could never tell you whether
you were seeing a problem or causing one.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from zeus_platform_core.repositories.jobs_admin import JOB_STATUSES
from zeus_platform_core.routers.admin_audit import audit_action
from zeus_platform_core.security import AdminDep, ContainerDep

router = APIRouter(prefix="/admin/jobs", tags=["admin"])

_STATUS_PATTERN = f"^({'|'.join(JOB_STATUSES)})$"


class CancelRequest(BaseModel):
    # Required, and stored in last_error where the job detail shows it. "Why was
    # this cancelled" is asked later by someone who was not there, and the only
    # moment the answer is reliably known is now.
    reason: str = Field(min_length=1, max_length=500)


class ReapRequest(BaseModel):
    module_id: str | None = Field(default=None, max_length=64)
    # Bounded so one sweep cannot become an unbounded UPDATE holding locks while
    # the queue stalls behind it. What it misses, the next sweep takes.
    max_rows: int = Field(default=1000, ge=1, le=10000)


@router.get("")
async def list_jobs(
    container: ContainerDep,
    admin: AdminDep,
    status: str | None = Query(default=None, pattern=_STATUS_PATTERN),
    module_id: str | None = Query(default=None, max_length=64),
    tenant_id: str | None = Query(default=None),
    kind: str | None = Query(default=None, max_length=100),
    stuck: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, object]:
    """Jobs newest first. ``stuck=true`` is the filter that matters in an incident.

    ``total`` is a real count rather than a page-size heuristic, so the console
    can paginate honestly instead of showing a next button that is always
    enabled and sometimes lies.
    """
    filters = {
        "status": status,
        "module_id": module_id,
        "tenant_id": tenant_id,
        "kind": kind,
        "stuck": stuck,
    }
    jobs = await container.jobs_admin.list_jobs(limit=limit, offset=offset, **filters)
    total = await container.jobs_admin.count_jobs(**filters)
    return {"jobs": jobs, "total": total, "limit": limit, "offset": offset}


@router.get("/health")
async def queue_health(container: ContainerDep, admin: AdminDep) -> dict[str, object]:
    """Depth, age and failure rate per module. Read-only, deliberately.

    Not audited: this is the screen an operator refreshes during an incident,
    and a trail full of health checks buries the actions that changed something.
    """
    return await container.jobs_admin.queue_health()


@router.get("/{job_id}")
async def get_job(
    job_id: str, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    """One job in full, including payload and result.

    Audited because of what it returns. This is the only route on the platform
    that hands an operator another tenant's data, and a record of who opened
    which job is the difference between a support tool and an unaccountable one.
    """
    job = await container.jobs_admin.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await audit_action(
        container,
        request,
        admin,
        "job.viewed",
        target_type="job",
        target_id=job_id,
        after={"kind": job.get("kind"), "tenant_id": str(job.get("tenant_id") or "")},
    )
    return {"job": job}


@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: str,
    body: CancelRequest,
    request: Request,
    container: ContainerDep,
    admin: AdminDep,
) -> dict[str, object]:
    """Stop a queued or running job.

    A job that already finished is a 409, not a silent success. The operator
    pressed cancel expecting something to stop; being told it had already
    succeeded is the useful answer, and reporting "cancelled" for a job that ran
    to completion would make the ledger lie.
    """
    job = await container.jobs_admin.cancel(job_id, reason=body.reason)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "cancelled":
        raise HTTPException(
            status_code=409,
            detail=f"Job is {job['status']} and can no longer be cancelled.",
        )
    await audit_action(
        container,
        request,
        admin,
        "job.cancelled",
        target_type="job",
        target_id=job_id,
        after={"kind": job.get("kind"), "reason": body.reason},
    )
    return {"job": job}


@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    """Requeue a failed or cancelled job with its attempt count reset.

    Resetting is the point. An operator pressing retry is asserting the cause is
    fixed; carrying the old count forward would mean an exhausted job is retried
    once, immediately fails as exhausted again, and the button looks broken.

    ``superseded`` is its own answer because the alternative is a 500. The
    partial unique index on ``(kind, idempotency_key)`` covers live statuses, so
    requeueing a job whose key a newer live job now holds would raise an
    integrity error. It is detected in SQL and reported as the conflict it is.
    """
    job, outcome = await container.jobs_admin.retry(job_id)
    if outcome == "not_found":
        raise HTTPException(status_code=404, detail="Job not found")
    if outcome == "not_retryable":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Job is {job['status'] if job else 'unknown'}; only failed or "
                "cancelled jobs can be retried."
            ),
        )
    if outcome == "superseded":
        raise HTTPException(
            status_code=409,
            detail="A live job already holds this idempotency key; nothing to retry.",
        )
    await audit_action(
        container,
        request,
        admin,
        "job.retried",
        target_type="job",
        target_id=job_id,
        after={"kind": job.get("kind") if job else None},
    )
    return {"job": job, "outcome": outcome}


@router.post("/reap")
async def reap_leases(
    body: ReapRequest, request: Request, container: ContainerDep, admin: AdminDep
) -> dict[str, object]:
    """Recover jobs whose worker died holding the lease.

    Normally unnecessary: ``claim_job`` sweeps before every claim, so a module
    with live workers repairs itself. This is for the case that sweep cannot
    cover -- no worker is claiming, so nothing runs the recovery, and the jobs
    stay ``running`` behind leases no process still holds.

    Audited with the job ids rather than a count, so the trail says what was
    changed instead of how many.
    """
    reaped = await container.jobs_admin.reap(
        module_id=body.module_id, max_rows=body.max_rows
    )
    if reaped:
        await audit_action(
            container,
            request,
            admin,
            "jobs.reaped",
            target_type="module",
            target_id=body.module_id or "all",
            after={
                "count": len(reaped),
                "job_ids": [str(r["id"]) for r in reaped[:50]],
                "requeued": sum(1 for r in reaped if r["outcome"] == "requeued"),
                "exhausted": sum(1 for r in reaped if r["outcome"] == "exhausted"),
            },
        )
    return {"reaped": reaped, "count": len(reaped)}
