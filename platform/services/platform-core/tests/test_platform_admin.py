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
    # Tenant control (Phase 5). Suspending a customer is the single most
    # destructive thing this API can do, so it is covered by the same
    # exhaustive guard sweep as everything else.
    ("get", "/admin/tenants", None, "/admin/tenants"),
    ("get", f"/admin/tenants/{TENANT}", None, "/admin/tenants/{tenant_id}"),
    (
        "post",
        f"/admin/tenants/{TENANT}/status",
        {"status": "suspended", "reason": "nonpayment"},
        "/admin/tenants/{tenant_id}/status",
    ),
    ("get", f"/admin/tenants/{TENANT}/limits", None, "/admin/tenants/{tenant_id}/limits"),
    (
        "put",
        f"/admin/tenants/{TENANT}/limits/scans_per_month",
        {"limit_value": 500, "reason": "sales concession"},
        "/admin/tenants/{tenant_id}/limits/{limit_key}",
    ),
    (
        "delete",
        f"/admin/tenants/{TENANT}/limits/scans_per_month",
        None,
        "/admin/tenants/{tenant_id}/limits/{limit_key}",
    ),
    # Catalogue control (Phase 5b). Editing a price or a plan limit changes
    # what every customer is charged and allowed, so it belongs behind the
    # same sweep.
    ("get", "/admin/plans", None, "/admin/plans"),
    ("get", "/admin/plans/gi_growth", None, "/admin/plans/{plan_id}"),
    (
        "post",
        "/admin/plans",
        {"id": "x", "module_id": "m", "name": "X", "monthly_cents": 1, "annual_cents": 1},
        "/admin/plans",
    ),
    ("patch", "/admin/plans/gi_growth", {"name": "X"}, "/admin/plans/{plan_id}"),
    (
        "put",
        "/admin/plans/gi_growth/limits",
        {"limits": {"scans_per_month": 10}},
        "/admin/plans/{plan_id}/limits",
    ),
    ("get", "/admin/models", None, "/admin/models"),
    (
        "put",
        "/admin/models/gpt-5-mini",
        {"input_per_million_usd": "1", "output_per_million_usd": "2"},
        "/admin/models/{model}",
    ),
    ("delete", "/admin/models/gpt-5-mini", None, "/admin/models/{model}"),
    ("post", "/admin/billing/test-connection", None, "/admin/billing/test-connection"),
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

    Every module contributing admin routes must be named here. Splitting the
    admin surface across routers is what makes that necessary: a new router
    nobody added to this tuple would be invisible to the sweep, so the tuple is
    the one thing a reviewer has to check when a new admin router appears.
    """
    from zeus_platform_core.routers import admin, admin_catalog, admin_tenants

    listed = {(m.lower(), template) for m, _, _, template in ADMIN_ROUTES}
    actual = {
        (method.lower(), route.path)
        for module in (admin, admin_catalog, admin_tenants)
        for route in module.router.routes
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
    assert written[0][2] == "setting.update"
    recorded = json.dumps([str(a) for a in written[0]])
    assert "llm.model" in recorded
    assert "sk-looks-like-a-secret" not in recorded
    assert "changed" in recorded


def test_prompt_activation_is_audited(operator):
    client, written = operator

    resp = client.post("/admin/prompts/activate", json={"name": "p", "version": 3}, headers=AUTH)

    assert resp.status_code == 200
    assert len(written) == 1
    assert written[0][2] == "prompt.activate"


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


# --- 4. tenant control is audited -------------------------------------------
#
# These go through the real routes rather than calling the repository, because
# the thing being tested is that the route writes the audit row -- a repository
# test would pass whether or not anyone ever called it. The first version of
# this file had no such test, and a deliberate break (removing the audit call
# from the override route) went unnoticed by the entire suite.


def _tenant_db() -> FakeDatabase:
    """A fake database rich enough for the tenant-control routes.

    Needle order matters: FakeDatabase returns the first registered substring
    match, and ``set_status``'s UPDATE also contains ``FROM platform.tenants``.
    The specific handlers therefore have to be registered before the general
    one, or the update would be answered by the lookup stub.
    """
    db = _db(is_admin=True)

    db.on_fetch_one(
        "UPDATE platform.tenants",
        lambda args: {"previous_status": "active", "status": args[1]},
    )
    db.on_fetch_one(
        "INSERT INTO platform.tenant_limit_overrides",
        lambda args: {
            "limit_key": args[1],
            "limit_value": args[2],
            "reason": args[3],
            "created_at": None,
            "updated_at": None,
        },
    )
    db.on_fetch_one("SELECT limit_value, reason", lambda args: None)
    db.on_fetch_one(
        "DELETE FROM platform.tenant_limit_overrides",
        lambda args: {"limit_key": args[1], "limit_value": 10, "reason": "old"},
    )
    db.on_fetch_one(
        "FROM platform.tenants WHERE id",
        lambda args: {
            "id": TENANT,
            "name": "Acme",
            "slug": "acme",
            "owner_user_id": USER,
            "status": "active",
            "stripe_customer_id": None,
        },
    )
    db.on_fetch(
        "FROM platform.plan_limits",
        lambda args: [
            {"plan_id": "gi_growth", "limit_key": "matches_per_month", "limit_value": 100}
        ],
    )
    return db


@pytest.fixture
def tenant_operator() -> Iterator[tuple[TestClient, list[tuple]]]:
    auth = StubAuth([PLATFORM_ADMIN_ROLE])
    container = Container(db=_tenant_db(), cache=MemoryCache(), auth=auth)

    written: list[tuple] = []

    async def capture(query: str, *args):
        if "admin_audit" in query:
            written.append(args)
        return "INSERT 0 1"

    container.db.execute = capture  # type: ignore[method-assign]
    yield TestClient(create_app(container)), written


def test_suspending_a_tenant_is_audited_with_both_statuses(tenant_operator):
    """Before and after are both recorded, from the same statement that wrote it.

    A trail saying only "suspended" cannot answer whether the tenant was
    already suspended, which is the difference between an action and a no-op.
    """
    client, written = tenant_operator

    resp = client.post(
        f"/admin/tenants/{TENANT}/status",
        json={"status": "suspended", "reason": "non-payment"},
        headers=AUTH,
    )

    assert resp.status_code == 200
    assert resp.json()["previous_status"] == "active"
    assert resp.json()["status"] == "suspended"

    assert len(written) == 1
    # Positional, against the INSERT's argument order:
    #   (actor_user_id, actor_email, action, target_type, target_id, before, after, ...)
    # Asserting equality rather than substring containment: an earlier version
    # used `in`, and a break that renamed the action to "tenant.status.set.X"
    # still passed, because the old name is a prefix of the new one.
    assert written[0][2] == "tenant.status.set"
    assert written[0][3] == "tenant"
    assert written[0][4] == TENANT
    assert json.loads(written[0][5]) == {"status": "active"}
    assert json.loads(written[0][6]) == {"status": "suspended", "reason": "non-payment"}


def test_suspension_leaves_the_tenant_entitled_to_nothing(tenant_operator):
    """The route recomputes rather than waiting for the 300s cache TTL to lapse.

    Without the explicit invalidate-and-refresh, a suspended tenant keeps
    working for up to five minutes and the operator concludes the button is
    broken.
    """
    client, _ = tenant_operator

    resp = client.post(
        f"/admin/tenants/{TENANT}/status",
        json={"status": "suspended", "reason": "non-payment"},
        headers=AUTH,
    )

    assert resp.status_code == 200
    assert resp.json()["active_modules"] == []


def test_setting_a_limit_override_is_audited(tenant_operator):
    client, written = tenant_operator

    resp = client.put(
        f"/admin/tenants/{TENANT}/limits/matches_per_month",
        json={"limit_value": 500, "reason": "sales concession"},
        headers=AUTH,
    )

    assert resp.status_code == 200, resp.text
    assert len(written) == 1
    assert written[0][2] == "tenant.limit.set"
    assert written[0][4] == TENANT
    # No previous override, so `before` is null rather than a row of nulls --
    # "there was nothing here" and "it was explicitly unlimited" are different
    # facts and the trail has to keep them apart.
    assert written[0][5] is None
    assert json.loads(written[0][6]) == {
        "limit_key": "matches_per_month",
        "limit_value": 500,
        "reason": "sales concession",
    }


def test_clearing_a_limit_override_is_audited(tenant_operator):
    client, written = tenant_operator

    resp = client.delete(f"/admin/tenants/{TENANT}/limits/matches_per_month", headers=AUTH)

    assert resp.status_code == 200, resp.text
    assert len(written) == 1
    assert written[0][2] == "tenant.limit.cleared"
    assert json.loads(written[0][5]) == {"limit_key": "matches_per_month", "limit_value": 10}
    assert written[0][6] is None


def test_an_unknown_limit_key_is_refused_rather_than_silently_stored(tenant_operator):
    """A typo would write a row that resolves against nothing.

    That is the worst failure mode available here: silent, and indistinguishable
    from success to the operator who made it.
    """
    client, written = tenant_operator

    resp = client.put(
        f"/admin/tenants/{TENANT}/limits/maches_per_month",
        json={"limit_value": 500, "reason": "typo"},
        headers=AUTH,
    )

    assert resp.status_code == 400
    assert "unknown limit key" in resp.json()["detail"]
    assert written == []


def test_an_override_without_a_reason_is_refused(tenant_operator):
    """Required at write time because that is the only moment anyone knows it."""
    client, written = tenant_operator

    resp = client.put(
        f"/admin/tenants/{TENANT}/limits/matches_per_month",
        json={"limit_value": 500},
        headers=AUTH,
    )

    assert resp.status_code == 422
    assert written == []


def test_a_tenant_cannot_be_deleted_through_the_status_route(tenant_operator):
    """``deleted`` is valid in the database but is not offered here.

    Deletion has to deal with retention and Stripe cancellation; a status flip
    that merely looks like a delete is worse than having no delete at all.
    """
    client, written = tenant_operator

    resp = client.post(
        f"/admin/tenants/{TENANT}/status",
        json={"status": "deleted", "reason": "cleanup"},
        headers=AUTH,
    )

    assert resp.status_code == 422
    assert written == []
