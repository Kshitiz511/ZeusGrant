"""The Vercel entrypoint: mounts, lifespan propagation and the startup fallback.

These are cheap assertions about wiring that would otherwise only fail in
production, on a cold start, after a deploy.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("ZEUS_DATABASE_URL", "postgresql://u:p@localhost:5432/db")

from api.index import app, cc_app, core_app  # noqa: E402


def test_prefixes_match_the_vite_dev_proxy():
    # The frontend calls the same paths in dev and prod; a mismatch here means
    # every API call 404s once deployed.
    mounted = {r.path for r in app.routes}
    assert "/api/core" in mounted
    assert "/api/cc" in mounted


def test_health_answers_without_querying_the_database(monkeypatch):
    from fastapi.testclient import TestClient

    # Startup is stubbed, so a real pool is never opened. If /api/health touched
    # the database this would raise instead of returning 200 -- a liveness probe
    # that depends on Postgres makes an outage indistinguishable from a crash.
    monkeypatch.setattr(core_app.state.container, "startup", _noop)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)

    res = TestClient(app).get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_startup_fallback_runs_once_per_instance(monkeypatch):
    from fastapi.testclient import TestClient

    import api.index as entry

    calls: list[str] = []

    async def counting():
        calls.append("x")

    monkeypatch.setattr(core_app.state.container, "startup", counting)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)
    monkeypatch.setattr(entry, "_started", False)

    client = TestClient(app)
    client.get("/api/health")
    client.get("/api/health")

    # Vercel may not emit lifespan on a cold start, so the middleware is the
    # safety net -- but it must not reconnect on every request.
    assert calls == ["x"]


@pytest.mark.asyncio
async def test_lifespan_starts_both_sub_apps(monkeypatch):
    started: list[str] = []

    async def fake_core_startup():
        started.append("core")

    async def fake_cc_startup():
        started.append("cc")

    monkeypatch.setattr(core_app.state.container, "startup", fake_core_startup)
    monkeypatch.setattr(cc_app.state.container, "startup", fake_cc_startup)
    monkeypatch.setattr(core_app.state.container, "shutdown", _noop)
    monkeypatch.setattr(cc_app.state.container, "shutdown", _noop)

    # Starlette does not propagate lifespan into mounted apps. Without the
    # explicit propagation in api/index.py the pools are never opened.
    async with app.router.lifespan_context(app):
        assert started == ["core", "cc"]


async def _noop() -> None:
    return None
