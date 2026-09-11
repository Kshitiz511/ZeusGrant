"""Vercel serverless entrypoint.

Both services are mounted into one ASGI app behind a single function, and the
prefixes match the Vite dev proxy exactly (``/api/core``, ``/api/cc``). The
browser therefore calls the same paths in development and production, and the
frontend needs no environment-specific base URL.

One function rather than two, deliberately:

* **Cold starts.** Each Vercel function is its own instance with its own
  connection pool and its own cold start. Splitting these doubles both for a
  console page that routinely calls core and contract-compliance together.
* **Cookies.** Session cookies are host-scoped. Same origin, same function,
  no cross-service cookie or CORS handling.

The trade-off is that the two services no longer scale independently. That is
acceptable while they are deployed together anyway; if contract-compliance ever
needs its own scaling profile, splitting this file is a small change.

Startup is lazy. Vercel gives no lifespan guarantees on a cold start, so each
sub-app connects its database on first use rather than at import.
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path

# The workspace packages are installed by requirements.txt, but the build also
# needs the source tree importable when Vercel runs from the repo root.
_ROOT = Path(__file__).resolve().parent.parent
for _pkg in ("packages/config", "packages/adapters", "packages/service-kit"):
    sys.path.insert(0, str(_ROOT / _pkg / "src"))
for _svc in ("services/platform-core", "services/contract-compliance"):
    sys.path.insert(0, str(_ROOT / _svc / "src"))

from fastapi import FastAPI, Request, Response  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from zeus_contract_compliance.app import create_app as create_cc_app  # noqa: E402
from zeus_platform_core.app import create_app as create_core_app  # noqa: E402

core_app = create_core_app()
cc_app = create_cc_app()

# One-shot startup guard, per warm instance.
_started = False
_start_lock = asyncio.Lock()


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Run both mounted sub-apps' lifespans.

    Starlette does **not** propagate lifespan into mounted sub-applications, so
    without this the connection pools are never opened and the first query
    raises "Database pool is not connected". Nothing in the local test suite
    catches it, because there each app is served standalone.
    """
    global _started
    async with (
        core_app.router.lifespan_context(core_app),
        cc_app.router.lifespan_context(cc_app),
    ):
        _started = True
        yield


app = FastAPI(
    title="Zeus Platform",
    docs_url=None,  # the sub-apps expose their own
    redoc_url=None,
    openapi_url=None,
    lifespan=_lifespan,
)


@app.middleware("http")
async def _ensure_started(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Fallback startup for hosts that do not emit ASGI lifespan events.

    Vercel's Python runtime makes no documented guarantee that lifespan runs on
    a cold start. Relying on it alone would mean the failure only appears in
    production, on the first request after a scale-up. This runs startup once
    per instance and is a no-op when lifespan already did the work, since
    ``connect()`` returns early if the pool exists.
    """
    global _started
    if not _started:
        async with _start_lock:
            if not _started:
                await core_app.state.container.startup()
                await cc_app.state.container.startup()
                _started = True
    return await call_next(request)


@app.get("/api/health")
async def health() -> JSONResponse:
    """Cheap liveness probe that does not touch the database.

    Readiness (database, cache, queue) is reported per-service at
    ``/api/core/health`` so a dependency outage is attributable.
    """
    return JSONResponse(
        {
            "status": "ok",
            "env": os.getenv("ZEUS_ENV", "unknown"),
            "commit": os.getenv("VERCEL_GIT_COMMIT_SHA", "local")[:7],
        }
    )


app.mount("/api/core", core_app)
app.mount("/api/cc", cc_app)
