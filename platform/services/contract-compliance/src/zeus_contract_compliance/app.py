"""Contract Compliance FastAPI app.

Wires the container and the shared security kit into an app. The DB pool
opens on startup; the entitlement guard (via ``app.state.security``) protects
every business route.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from zeus_contract_compliance.container import Container
from zeus_contract_compliance.jobs import router as jobs_router
from zeus_contract_compliance.routers import audit_router, obligations_router
from zeus_contract_compliance.routers import router as contracts_router


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    container: Container = app.state.container
    await container.startup()
    try:
        yield
    finally:
        await container.shutdown()


def create_app(container: Container | None = None) -> FastAPI:
    app = FastAPI(
        title="Zeus Contract Compliance",
        version="0.1.0",
        description="Contracts, obligations and AI obligation extraction.",
        lifespan=_lifespan,
    )
    app.state.container = container or Container()

    @app.get("/health", tags=["health"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(contracts_router)
    app.include_router(obligations_router)
    app.include_router(audit_router)
    app.include_router(jobs_router)
    return app


app = create_app()
