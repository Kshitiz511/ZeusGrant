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


def test_startup_failure_degrades_instead_of_crashing_the_function(monkeypatch):
    from fastapi.testclient import TestClient

    import api.index as entry

    async def boom():
        raise RuntimeError("pool refused")

    monkeypatch.setattr(core_app.state.container, "startup", boom)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)
    monkeypatch.setattr(entry, "_started", False)
    monkeypatch.setattr(entry, "_startup_error", None)

    # A raised startup error takes the whole function down with an opaque crash
    # page -- including the endpoint whose job is to explain the failure.
    res = TestClient(app).get("/api/health")
    assert res.status_code == 503
    body = res.json()
    assert body["status"] == "degraded"
    assert "pool refused" in body["startup_error"]


def test_startup_failure_is_retried_on_the_next_request(monkeypatch):
    from fastapi.testclient import TestClient

    import api.index as entry

    attempts: list[int] = []

    async def flaky():
        attempts.append(1)
        if len(attempts) == 1:
            raise RuntimeError("transient")

    monkeypatch.setattr(core_app.state.container, "startup", flaky)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)
    monkeypatch.setattr(entry, "_started", False)
    monkeypatch.setattr(entry, "_startup_error", None)

    client = TestClient(app)
    assert client.get("/api/health").status_code == 503
    # Caching the failure as "started" would leave the instance permanently
    # broken after a momentary database blip.
    assert client.get("/api/health").status_code == 200


def test_unmatched_api_path_404s_instead_of_returning_the_spa(monkeypatch):
    from fastapi.testclient import TestClient

    import api.index as entry

    if not (entry._DIST / "index.html").exists():
        pytest.skip("console not built")

    monkeypatch.setattr(core_app.state.container, "startup", _noop)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)

    # The SPA catch-all is mounted at "/", so an unmatched API path reaches it.
    # Answering with 200 and HTML would surface to clients as a JSON parse
    # error and would look like success to monitoring.
    res = TestClient(app).get("/api/does-not-exist")
    assert res.status_code == 404
    assert "text/html" not in res.headers.get("content-type", "")


def test_deep_link_returns_the_spa_for_client_side_routing(monkeypatch):
    from fastapi.testclient import TestClient

    import api.index as entry

    if not (entry._DIST / "index.html").exists():
        pytest.skip("console not built")

    monkeypatch.setattr(core_app.state.container, "startup", _noop)
    monkeypatch.setattr(cc_app.state.container, "startup", _noop)

    res = TestClient(app).get("/contracts/123")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]


async def _noop() -> None:
    return None
