"""Internal worker endpoint — the async AI path.

Serverless-native: there is no long-lived worker process on Vercel, so the
queue delivers a wake-up by calling this endpoint over HTTP and the worker
drains whatever this module has queued. It is machine-to-machine, authenticated
by a shared secret rather than a user session, because the caller is a
scheduler and not a person.

This endpoint deliberately takes no job id. The previous version accepted the
tenant and contract to process directly from the message body, which meant a
replayed or forged payload could choose which work ran, and a duplicate
delivery would run the same analysis twice. The worker now claims the next job
from its own module's ledger and ignores the payload entirely, so a message can
only ever say "wake up", never "do this".
"""

from __future__ import annotations

import hmac
from typing import Annotated, Any

from fastapi import APIRouter, Body, HTTPException, Request, status

from zeus_contract_compliance.container import Container

router = APIRouter(prefix="/internal/jobs", tags=["internal"])

#: Bounded well inside Vercel's 60-second function limit so the job in hand can
#: finish and be recorded, rather than being killed mid-write and leaving a
#: lease to expire.
DRAIN_SECONDS = 45.0


def _container(request: Request) -> Container:
    return request.app.state.container


@router.post("/run", include_in_schema=False)
async def run_worker(
    request: Request,
    secret: Annotated[str, Body(embed=True)],
    max_jobs: Annotated[int, Body(embed=True)] = 5,
) -> dict[str, Any]:
    """Drain a few Contract Compliance jobs, then return."""
    container = _container(request)

    expected = container.settings.worker_secret
    if expected is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No worker secret configured; the HTTP worker is disabled.",
        )
    # Constant time, so the endpoint cannot be used as an oracle to recover the
    # secret one byte at a time.
    if not hmac.compare_digest(secret, expected.get_secret_value()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid worker secret."
        )

    worker = container.build_worker()
    return await worker.drain(max_jobs=max_jobs, max_seconds=DRAIN_SECONDS)
