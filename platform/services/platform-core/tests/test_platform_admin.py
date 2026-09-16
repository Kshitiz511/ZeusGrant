"""Who may act as a platform operator, and how that privilege is obtained.

Closes D13. The guard ``require_platform_admin`` has existed since the admin
router was written, but nothing tested it and -- until migration 0016 --
nothing could satisfy it either. These tests pin down three separate claims:

1. **The guard refuses everyone without the role.** Ordinary users, workspace
   owners, and unauthenticated callers all get the same answer.

2. **The role cannot be self-granted.** ``POST /tenancy/token`` takes a token
   and returns a more privileged one. If it copied roles forward, anyone who
   ever held ``platform_admin`` -- or who could persuade any token issuer to
   include it -- would keep it permanently. It must be read from the database
   on every mint instead, which also means a revoke takes effect at the next
   mint rather than whenever the current token happens to expire.

3. **Every admin mutation is recorded.** Not "can be recorded": the route
   fails if the audit write fails, so an unaudited admin action is not a
   thing that can happen.

The audit table's append-only property is enforced by database privileges
(0016 revokes UPDATE and DELETE from ``zeus_app``) and so cannot be tested
against the fake database here -- it is verified directly against Postgres by
``scripts/probe_platform_admin.py``.
"""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.domain.models import PLATFORM_ADMIN_ROLE

TENANT = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
AUTH = {"Authorization": "Bearer good-token"}


class StubAuth:
    """Verifies one token and records every set of claims it is asked to mint."""

    def __init__(self, roles: list[str]) -> None:
        self._roles = roles
        self.issued: list[tuple[str, str, list[str]]] = []

    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        # email is None on purpose: first-party tokens carry only a subject and
        # roles, so anything that needs an address must look it up.
        return Session(user_id=USER, email=None, tenant_id=TENANT, roles=list(self._roles))

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        self.issued.append((user_id, tenant_id, list(roles)))
        return f"token:{tenant_id}"


def _db(*, is_admin: bool) -> FakeDatabase:
    db = FakeDatabase()
    db.on_fetch_one("is_platform_admin", lambda args: {"is_platform_admin": is_admin})
    db.on_fetch_one("FROM platform.memberships", lambda args: {"role": "owner"})
    db.on_fetch_one(
        "email_verified_at FROM platform.users",
        lambda args: {"id": USER, "email": "audit@example.com", "full_name": None},
    )
    return db


def _make(
    *, token_roles: list[str], db_flag: bool
) -> tuple[TestClient, StubAuth, list[tuple]]:
    """An app where the caller's token says one thing and the database another.

    Keeping the two independently settable is the entire point: the interesting
    cases are precisely those where they disagree.
    """
    auth = StubAuth(token_roles)
    container = Container(db=_db(is_admin=db_flag), cache=MemoryCache(), auth=auth)

    written: list[tuple] = []

    async def capture(query: str, *args):
        if "admin_audit" in query:
            written.append(args)
        return "INSERT 0 1"

    container.db.execute = capture  # type: ignore[method-assign]
    return TestClient(create_app(container)), auth, written


@pytest.fixture
def outsider() -> Iterator[TestClient]:
    """Authenticated, holds no platform role, and the database agrees."""
    client, _, _ = _make(token_roles=["owner"], db_flag=False)
    yield client


@pytest.fixture
def operator() -> Iterator[tuple[TestClient, list[tuple]]]:
    """Holds the role in the token, with the audit writes captured."""
    client, _, written = _make(token_roles=[PLATFORM_ADMIN_ROLE], db_flag=True)
    yield client, written


# --- 1. the guard refuses everyone without the role -------------------------

# (method, request path, body, route template). The request path is what the
# client calls; the template is what FastAPI registered. Both are needed: the
# first exercises the guard, the second proves the list below is complete.
ADMIN_ROUTES = [
    ("get", "/admin/settings", None, "/admin/settings"),
    ("put", "/admin/settings/zeus.some.key", {"value": "x"}, "/admin/settings/{key:path}"),
    ("delete", "/admin/settings/zeus.some.key", None, "/admin/settings/{key:path}"),
    ("put", "/admin/config", {"key": "k", "value": "v"}, "/admin/config"),
    ("get", "/admin/config/k", None, "/admin/config/{key}"),
    ("post", "/admin/prompts", {"name": "p", "body": "b"}, "/admin/prompts"),
    ("post", "/admin/prompts/activate", {"name": "p", "version": 1}, "/admin/prompts/activate"),
    ("get", "/admin/audit", None, "/admin/audit"),
]


@pytest.mark.parametrize(("method", "path", "body", "_template"), ADMIN_ROUTES)
def test_every_admin_route_refuses_a_non_admin(outsider, method, path, body, _template):
    """Being a workspace owner grants nothing at the platform level.

    Parametrised over the whole router rather than spot-checked, so a route
    added later without the dependency fails here instead of shipping open.
    """
    resp = getattr(outsider, method)(path, headers=AUTH, **({"json": body} if body else {}))

    assert resp.status_code == 403, f"{method.upper()} {path} was not refused"


@pytest.mark.parametrize(("method", "path", "body", "_template"), ADMIN_ROUTES)
def test_every_admin_route_refuses_an_anonymous_caller(outsider, method, path, body, _template):
    resp = getattr(outsider, method)(path, **({"json": body} if body else {}))

    assert resp.status_code == 401, f"{method.upper()} {path} was not refused"


def test_the_admin_router_has_no_unguarded_routes():
    """A structural check, not a behavioural one.

    The parametrised tests above can only cover routes somebody remembered to
    list. This asserts the list is complete, so a new endpoint cannot be added
    and silently escape both.
    """
    from zeus_platform_core.routers import admin

    listed = {(m.lower(), template) for m, _, _, template in ADMIN_ROUTES}
    actual = {
        (method.lower(), route.path)
        for route in admin.router.routes
        for method in getattr(route, "methods", set())
        if method != "HEAD"
    }

    assert actual == listed, f"admin routes not covered by the guard tests: {actual ^ listed}"


# --- 2. the role cannot be self-granted -------------------------------------


def test_token_exchange_ignores_platform_admin_in_the_incoming_token():
    """The forgery case: a token claiming the role, on an account without it.

    If the exchange merged roles forward, this would mint a genuine admin
    token from a forged claim. The database is the only source.
    """
    client, auth, _ = _make(token_roles=[PLATFORM_ADMIN_ROLE], db_flag=False)

    resp = client.post("/tenancy/token", json={"tenant_id": TENANT}, headers=AUTH)

    assert resp.status_code == 200
    _, _, minted = auth.issued[0]
    assert PLATFORM_ADMIN_ROLE not in minted
    assert minted == ["owner"]


def test_token_exchange_grants_the_role_from_the_database_flag():
    """The converse: the flag is honoured even though the token never had it."""
    client, auth, _ = _make(token_roles=["owner"], db_flag=True)

    resp = client.post("/tenancy/token", json={"tenant_id": TENANT}, headers=AUTH)

    assert resp.status_code == 200
    _, _, minted = auth.issued[0]
    assert minted == ["owner", PLATFORM_ADMIN_ROLE]


def test_a_revoked_flag_stops_being_minted():
    """Revocation takes effect at the next mint.

    The same account, the same token still claiming the role, but the flag is
    now false. This is what makes a revoke meaningful without waiting for the
    outstanding token to expire.
    """
    client, auth, _ = _make(token_roles=[PLATFORM_ADMIN_ROLE], db_flag=False)

    client.post("/tenancy/token", json={"tenant_id": TENANT}, headers=AUTH)

    assert all(PLATFORM_ADMIN_ROLE not in roles for _, _, roles in auth.issued)


# --- 3. every mutation is recorded ------------------------------------------


def test_setting_change_is_audited_without_recording_the_value(operator):
    """The value is a credential as often as not, so only the fact is kept.

    Uses a real managed key, because an invented one returns 404 before any
    audit write and would let this test pass while asserting nothing.

    Deliberately a NON-secret key. Secret keys need a SecretBox, which is
    configured from the environment -- the first version of this test used
    llm.openai_api_key, passed locally where that variable is set, and failed
    in CI where it is not. A test whose result depends on the machine is not
    testing the code. It also makes the stronger point: put_setting redacts
    unconditionally, so even a value that was never classified as sensitive
    stays out of the log.
    """
    client, written = operator

    resp = client.put(
        "/admin/settings/llm.model",
        json={"value": "sk-looks-like-a-secret"},
        headers=AUTH,
    )

    assert resp.status_code == 200
    assert len(written) == 1
    recorded = json.dumps([str(a) for a in written[0]])
    assert "setting.update" in recorded
    assert "llm.model" in recorded
    assert "sk-looks-like-a-secret" not in recorded
    assert "changed" in recorded


def test_prompt_activation_is_audited(operator):
    client, written = operator

    resp = client.post("/admin/prompts/activate", json={"name": "p", "version": 3}, headers=AUTH)

    assert resp.status_code == 200
    assert len(written) == 1
    assert "prompt.activate" in written[0]


def test_the_audit_row_names_the_operator_even_when_the_token_does_not(operator):
    """First-party tokens carry no email, so it is read from the database.

    Found by the end-to-end probe, not by these tests: the row was being
    written with actor_email NULL. It matters because actor_user_id is set to
    NULL when an account is deleted, and the flat email is then the only thing
    identifying who acted.
    """
    client, written = operator

    resp = client.post("/admin/prompts", json={"name": "p", "body": "b"}, headers=AUTH)

    assert resp.status_code == 200
    assert len(written) == 1
    # (actor_user_id, actor_email, action, ...) in the INSERT's argument order.
    assert written[0][1] == "audit@example.com"


def test_a_refused_call_writes_no_audit_row(outsider):
    """Rejections are not admin actions and must not pad the trail."""
    client, _, written = _make(token_roles=["owner"], db_flag=False)

    client.post("/admin/prompts/activate", json={"name": "p", "version": 3}, headers=AUTH)

    assert written == []


def test_reading_the_audit_log_is_not_itself_audited(operator):
    """Otherwise the screen that displays the log becomes its main contributor."""
    client, written = operator

    resp = client.get("/admin/audit", headers=AUTH)

    assert resp.status_code == 200
    assert written == []
