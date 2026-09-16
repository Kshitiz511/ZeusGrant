"""Platform core application.

Wires the container (adapters + repositories + services) into a FastAPI app.
The DB pool opens on startup and closes on shutdown. Business routers are
mounted here; the entitlement guard lives in ``security`` and is applied per
route or per module.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from zeus_platform_core.container import Container
from zeus_platform_core.health import router as health_router
from zeus_platform_core.routers.admin import router as admin_router
from zeus_platform_core.routers.auth import router as auth_router
from zeus_platform_core.routers.billing import router as billing_router
from zeus_platform_core.routers.entitlements import router as entitlements_router
from zeus_platform_core.routers.grants import router as grants_router
from zeus_platform_core.routers.tenancy import router as tenancy_router
from zeus_platform_core.routers.usage import router as usage_router


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
        title="Zeus Platform Core",
        version="0.1.0",
        description="Identity, tenancy, billing and entitlements — Phase 1.",
        lifespan=_lifespan,
    )
    app.state.container = container or Container()

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(tenancy_router)
    app.include_router(entitlements_router)
    app.include_router(billing_router)
    app.include_router(admin_router)
    app.include_router(grants_router)
    app.include_router(usage_router)

    settings = app.state.container.settings
    # Belt and braces: settings validation already refuses to construct a
    # production Settings with dev tokens on, but the mount is also gated so a
    # hand-built Settings in a test or script cannot expose it either.
    if settings.dev_tokens_enabled and not settings.is_production:
        from zeus_platform_core.routers.dev import router as dev_router

        app.include_router(dev_router)
    return app


app = create_app()

