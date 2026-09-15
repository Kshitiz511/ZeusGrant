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
import logging
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
from fastapi.staticfiles import StaticFiles  # noqa: E402
from starlette.exceptions import HTTPException as StarletteHTTPException  # noqa: E402
from zeus_contract_compliance.app import create_app as create_cc_app  # noqa: E402
from zeus_platform_core.app import create_app as create_core_app  # noqa: E402

core_app = create_core_app()
cc_app = create_cc_app()

# One-shot startup guard, per warm instance.
_started = False
_start_lock = asyncio.Lock()
#: Last startup failure, surfaced by /api/health instead of crashing the function.
_startup_error: str | None = None
logger = logging.getLogger("zeus.entrypoint")


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Run both mounted sub-apps' lifespans.

    Starlette does **not** propagate lifespan into mounted sub-applications, so
    without this the connection pools are never opened and the first query
    raises "Database pool is not connected". Nothing in the local test suite
    catches it, because there each app is served standalone.

    A failure here is logged rather than raised. Letting it propagate takes the
    whole function down with an opaque "Serverless Function has crashed" page --
    including ``/api/health``, the one endpoint whose job is to explain what is
    wrong. Requests then fail individually, with an attributable error.
    """
    global _started, _startup_error
    try:
        async with (
            core_app.router.lifespan_context(core_app),
            cc_app.router.lifespan_context(cc_app),
        ):
            _started = True
            _startup_error = None
            yield
            return
    except Exception as exc:  # pragma: no cover - exercised in deployment
        _startup_error = f"{type(exc).__name__}: {exc}"
        logger.exception("startup.failed")
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
    global _started, _startup_error
    if not _started:
        async with _start_lock:
            if not _started:
                try:
                    await core_app.state.container.startup()
                    await cc_app.state.container.startup()
                    _started = True
                    _startup_error = None
                except Exception as exc:  # pragma: no cover - deployment only
                    # Do not cache the failure as "started": a transient database
                    # blip would otherwise leave this instance permanently
                    # broken until it is recycled.
                    _startup_error = f"{type(exc).__name__}: {exc}"
                    logger.exception("startup.failed")
    return await call_next(request)


@app.get("/api/health")
async def health() -> JSONResponse:
    """Cheap liveness probe that does not touch the database.

    Readiness (database, cache, queue) is reported per-service at
    ``/api/core/health`` so a dependency outage is attributable.
    """
    return JSONResponse(
        {
            "status": "ok" if _startup_error is None else "degraded",
            "startup_error": _startup_error,
            "env": os.getenv("ZEUS_ENV", "unknown"),
            "commit": os.getenv("VERCEL_GIT_COMMIT_SHA", "local")[:7],
        },
        status_code=200 if _startup_error is None else 503,
    )


app.mount("/api/core", core_app)
app.mount("/api/cc", cc_app)


# --- console (SPA) --------------------------------------------------------
#
# Vercel detects this project as a backend framework and routes every path to
# this function, so the built console is served from here rather than from the
# static output directory. That is also the topology we want: the frontend and
# API share an origin, so session cookies stay host-scoped and there is no CORS
# surface at all.
#
# Mounted last so it cannot shadow /api/*.
_DIST = _ROOT / "apps" / "console" / "dist"

if _DIST.is_dir():

    class _SpaFiles(StaticFiles):
        """Static files with client-side-routing fallback.

        A deep link such as /contracts/123 has no file behind it; the router
        resolves it in the browser. Unknown paths therefore return index.html
        instead of 404.

        Two kinds of path are excluded from that fallback, for the same
        reason: returning HTML with a 200 to something that is not a page
        turns a clean 404 into a confusing parse error somewhere else.

        ``/api`` -- the sub-apps are mounted on exact prefixes, so an
        unmatched API path (a typo, a removed endpoint, a version skew) falls
        through to this mount. A client would see a JSON parse error instead
        of a 404, and monitoring would record success.

        ``/assets`` and anything else with a file extension -- every build
        asset is content-hashed, so its name changes on each deploy. A browser
        holding the previous page (or a tab left open across a deploy) asks
        for the old hash. Falling back served index.html as the script, the
        parse failed, and the whole console rendered as a blank white page
        with no failed request to point at. A 404 makes the browser report a
        missing script, which is the truth and is actionable.
        """

        async def get_response(self, path: str, scope):  # type: ignore[override]
            try:
                return await super().get_response(path, scope)
            except StarletteHTTPException as exc:
                if exc.status_code != 404:
                    raise
                request_path = scope.get("path", "")
                if request_path.startswith("/api"):
                    raise
                # A trailing extension means the caller wanted a file, not a
                # route. Client routes in this console are extension-free.
                if "." in request_path.rsplit("/", 1)[-1]:
                    raise
                return await super().get_response("index.html", scope)

    app.mount("/", _SpaFiles(directory=str(_DIST), html=True), name="console")
else:  # pragma: no cover - only when the frontend has not been built
    logger.warning("console.dist_missing path=%s", _DIST)
