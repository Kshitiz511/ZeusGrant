"""Admin control of the plan catalogue and model prices (Phase 5b).

Two things are being defended here, and they are not the same thing.

The first is **honesty about reach**. Editing a catalogue price does not change
what any existing subscriber pays -- Stripe does -- and deactivating a plan does
not revoke anybody's access. Both are the right behaviour and neither is what
the verb sounds like, so the API says so in the response. Several tests below
exist only to make sure that sentence cannot quietly disappear in a refactor,
because the failure it prevents is an operator believing they have given a
discount they have not given.

The second is **defect D7**: model prices used to be memoised in a plain dict on
a long-lived recorder, so an edited price took effect whenever the instance
happened to recycle, differently per instance. The price cache key is now
deleted on write, and that is asserted directly rather than inferred.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.repositories.plans import EDITABLE_PLAN_COLUMNS, PlanRepository
from zeus_platform_core.security import PLATFORM_ADMIN_ROLE
from zeus_platform_core.services.entitlements_service import _cache_key as entitlements_cache_key
from zeus_service_kit.metering import price_cache_key

TENANT = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
AUTH = {"Authorization": "Bearer good-token"}

PLAN = {
    "plan_id": "gi_growth",
    "module_id": "grant_intelligence",
    "name": "Growth",
    "monthly_cents": 9900,
    "annual_cents": 99000,
    "stripe_price_id_monthly": "price_m",
    "stripe_price_id_annual": None,
    "is_active": True,
    "limits": {"scans_per_month": 50},
    "subscriber_count": 3,
}


class StubAuth:
    def __init__(self, roles: list[str]) -> None:
        self._roles = roles

    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id=USER, email=None, tenant_id=TENANT, roles=list(self._roles))

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        return "token"


class StubBilling:
    """Stands in for Stripe. Records whether the provider was reset.

    The reset matters: ``test-connection`` exists to check the key that is
    *currently* configured, and a cached provider would make it report success
    for a key that had since been rotated away.
    """

    def __init__(self, price: dict | None = None, fails: Exception | None = None) -> None:
        self._price = price
        self._fails = fails
        self.resets = 0
        self.looked_up: list[str] = []

    def reset_provider(self) -> None:
        self.resets += 1

    async def get_price(self, price_id: str) -> dict | None:
        self.looked_up.append(price_id)
        if self._fails:
            raise self._fails
        return self._price

    async def test_connection(self) -> dict:
        if self._fails:
            raise self._fails
        return {"ok": True, "account_id": "acct_1", "livemode": False}


def _db() -> FakeDatabase:
    """A fake shaped like the real catalogue, with one plan and one price."""
    db = FakeDatabase()
    # The catalogue the list route reads. Mutable so a test can add a plan
    # without having to shadow an already-registered handler.
    db.plans = [dict(PLAN)]
    db.on_fetch_one("is_platform_admin", lambda args: {"is_platform_admin": True})
    db.on_fetch_one(
        "email_verified_at FROM platform.users",
        lambda args: {"id": USER, "email": "ops@example.com", "full_name": None},
    )
    # Plan reads. `WHERE p.id = $1` distinguishes the single-row read from the
    # list, which is otherwise the same projection.
    db.on_fetch_one(
        "WHERE p.id = $1",
        lambda args: dict(PLAN) if args[0] == PLAN["plan_id"] else None,
    )
    db.on_fetch("FROM platform.plans p", lambda args: list(db.plans))
    db.on_fetch(
        "FROM platform.modules",
        lambda args: [{"id": "grant_intelligence", "name": "Grant Intelligence"}],
    )
    db.on_fetch_one(
        "INSERT INTO platform.plans",
        lambda args: {"plan_id": args[0]} if args[0] != PLAN["plan_id"] else None,
    )
    # Model prices.
    db.on_fetch_one(
        "FROM platform.model_pricing WHERE model = $1",
        lambda args: (
            {
                "model": "gpt-5-mini",
                "input_per_million_usd": Decimal("0.25"),
                "output_per_million_usd": Decimal("2.00"),
            }
            if args[0] == "gpt-5-mini"
            else None
        ),
    )
    db.on_fetch_one(
        "INSERT INTO platform.model_pricing",
        lambda args: {
            "model": args[0],
            "input_per_million_usd": args[1],
            "output_per_million_usd": args[2],
        },
    )
    db.on_fetch_one(
        "DELETE FROM platform.model_pricing",
        lambda args: (
            {
                "model": args[0],
                "input_per_million_usd": Decimal("0.25"),
                "output_per_million_usd": Decimal("2.00"),
            }
            if args[0] == "gpt-5-mini"
            else None
        ),
    )
    db.on_fetch("FROM platform.subscriptions WHERE plan_id", lambda args: [{"tenant_id": TENANT}])
    return db


@pytest.fixture
def stack() -> Iterator[tuple[TestClient, list[tuple], MemoryCache, StubBilling, FakeDatabase]]:
    cache = MemoryCache()
    billing = StubBilling()
    db = _db()
    container = Container(db=db, cache=cache, auth=StubAuth([PLATFORM_ADMIN_ROLE]))
    container.__dict__["billing"] = billing

    written: list[tuple] = []
    real_execute = db.execute

    async def capture(query: str, *args):
        if "admin_audit" in query:
            written.append(args)
        return await real_execute(query, *args)

    db.execute = capture  # type: ignore[method-assign]
    yield TestClient(create_app(container)), written, cache, billing, db


# --- what an edit does not do ------------------------------------------------


def test_a_price_change_says_it_does_not_re_price_subscribers(stack):
    """The most expensive misunderstanding this API can cause.

    An operator who lowers `monthly_cents` expecting existing customers to be
    charged less has given a discount that does not exist. The warning names
    the subscriber count so it reads as a fact about their data rather than
    boilerplate they learn to skip.
    """
    client, _, _, _, _ = stack

    resp = client.patch("/admin/plans/gi_growth", headers=AUTH, json={"monthly_cents": 4900})

    assert resp.status_code == 200
    warnings = " ".join(resp.json()["warnings"])
    assert "does not re-price anyone" in warnings
    assert "3 subscriber(s)" in warnings


def test_deactivating_a_plan_says_subscribers_keep_access(stack):
    """`is_active` hides the plan from checkout; it is not a kill switch."""
    client, _, _, _, _ = stack

    resp = client.patch("/admin/plans/gi_growth", headers=AUTH, json={"is_active": False})

    warnings = " ".join(resp.json()["warnings"])
    assert "keep their access" in warnings
    assert "3 subscriber(s) keep access" in warnings


def test_renaming_a_plan_carries_no_price_warning(stack):
    """Otherwise every save warns, and a warning on every save is noise."""
    client, _, _, _, _ = stack

    resp = client.patch("/admin/plans/gi_growth", headers=AUTH, json={"name": "Growth+"})

    assert resp.json()["warnings"] == []


# --- the patch body ----------------------------------------------------------


def test_clearing_a_stripe_id_is_distinguishable_from_omitting_it(stack):
    """Without this there is no way to correct a plan wrongly marked sellable.

    `exclude_unset` is what separates "set this to null" from "do not mention
    it". If the router used truthiness instead, a null would be indistinguish-
    able from an absent field and the id could only ever be changed, never
    removed.
    """
    client, _, _, _, db = stack

    resp = client.patch(
        "/admin/plans/gi_growth", headers=AUTH, json={"stripe_price_id_monthly": None}
    )

    assert resp.status_code == 200
    sets = [
        args
        for kind, query, args in db.calls
        if kind == "execute" and "UPDATE platform.plans" in query
    ]
    assert sets and sets[0][1] is None


def test_an_empty_patch_is_refused(stack):
    """A no-op write would still produce an audit row claiming a change."""
    client, _, _, _, _ = stack

    assert client.patch("/admin/plans/gi_growth", headers=AUTH, json={}).status_code == 400


def test_patching_an_unknown_plan_is_404(stack):
    client, _, _, _, _ = stack

    resp = client.patch("/admin/plans/nope", headers=AUTH, json={"name": "x"})

    assert resp.status_code == 404


# --- what may be edited ------------------------------------------------------


def test_module_id_is_not_editable():
    """Moving a plan between modules silently re-grants its subscribers.

    It is not an edit to the plan, it is a change to what every existing
    customer on it is entitled to, with no billing event anywhere. Asserted at
    the repository because that is where the SET clause is built.
    """
    assert "module_id" not in EDITABLE_PLAN_COLUMNS


@pytest.mark.asyncio
async def test_the_repository_refuses_a_column_it_does_not_own():
    """The column names are interpolated into SQL, so this is the injection guard."""
    repo = PlanRepository(_db())

    with pytest.raises(ValueError, match="not editable"):
        await repo.update("gi_growth", {"id": "hijacked"})


def test_creating_a_plan_in_an_unknown_module_is_a_400(stack):
    """`module_id` has a foreign key; unchecked it would be a 500 nobody can act on."""
    client, _, _, _, _ = stack

    resp = client.post(
        "/admin/plans",
        headers=AUTH,
        json={
            "plan_id": "new_plan",
            "module_id": "does_not_exist",
            "name": "New",
            "monthly_cents": 100,
        },
    )

    assert resp.status_code == 400
    assert "unknown module" in resp.json()["detail"]


def test_creating_a_plan_that_exists_is_a_409_not_an_overwrite(stack):
    """An upsert here would re-price the existing plan's subscribers via a typo."""
    client, _, _, _, _ = stack

    resp = client.post(
        "/admin/plans",
        headers=AUTH,
        json={
            "plan_id": "gi_growth",
            "module_id": "grant_intelligence",
            "name": "Collision",
            "monthly_cents": 100,
        },
    )

    assert resp.status_code == 409


# --- Stripe price id validation ---------------------------------------------


def test_a_price_id_stripe_does_not_recognise_is_warned_about(stack):
    """Silent acceptance means discovering it when a customer cannot check out."""
    client, _, _, billing, _ = stack
    billing._price = None

    resp = client.patch(
        "/admin/plans/gi_growth", headers=AUTH, json={"stripe_price_id_monthly": "price_typo"}
    )

    assert resp.status_code == 200, "validation warns, it does not refuse the save"
    assert any("does not recognise" in w for w in resp.json()["warnings"])


def test_a_stripe_amount_that_disagrees_with_the_catalogue_is_warned_about(stack):
    """The pricing page and the invoice disagreeing is the worst kind of bug."""
    client, _, _, billing, _ = stack
    billing._price = {"active": True, "unit_amount": 4900, "interval": "month"}

    resp = client.patch(
        "/admin/plans/gi_growth",
        headers=AUTH,
        json={"stripe_price_id_monthly": "price_m", "monthly_cents": 9900},
    )

    warnings = " ".join(resp.json()["warnings"])
    assert "charges 4900" in warnings and "catalogue says 9900" in warnings


def test_stripe_being_unreachable_does_not_block_the_edit(stack):
    """Otherwise the catalogue is uneditable exactly when it needs fixing."""
    client, _, _, billing, _ = stack
    billing._fails = RuntimeError("stripe down")

    resp = client.patch(
        "/admin/plans/gi_growth", headers=AUTH, json={"stripe_price_id_monthly": "price_m"}
    )

    assert resp.status_code == 200
    assert any("Could not verify" in w for w in resp.json()["warnings"])


def test_a_plan_active_with_no_stripe_price_is_named_as_unsellable(stack):
    """It vanishes from /billing/plans, which looks like the pricing page breaking.

    Naming the condition on the admin screen is the difference between a
    five-minute fix and an afternoon spent reading the storefront query.
    """
    client, _, _, _, db = stack
    db.plans.append({**PLAN, "plan_id": "gi_orphan", "stripe_price_id_monthly": None})

    body = client.get("/admin/plans", headers=AUTH).json()

    assert body["unsellable_active_plans"] == ["gi_orphan"]
    assert len(body["plans"]) == 2, "the unsellable plan is still listed, not hidden"


# --- plan limits -------------------------------------------------------------


def test_setting_limits_invalidates_the_subscribers_caches(stack):
    """Limits, unlike prices, do apply to existing subscribers immediately.

    Without invalidation the change appears to do nothing until the TTL lapses,
    and an operator who cannot see their edit applies it again. The cached
    snapshot is seeded first: counting the affected tenants in the response is
    not evidence that any cache was actually dropped.
    """
    client, _, cache, _, _ = stack
    key = entitlements_cache_key(TENANT)
    asyncio.run(cache.set(key, '{"stale": true}'))

    resp = client.put(
        "/admin/plans/gi_growth/limits", headers=AUTH, json={"limits": {"scans_per_month": 100}}
    )

    assert resp.status_code == 200
    assert resp.json()["tenants_invalidated"] == 1
    assert asyncio.run(cache.get(key)) is None, "the subscriber kept their old limits"


def test_limits_are_replaced_not_merged(stack):
    """A key the caller omitted is a key the plan no longer has.

    This is the opposite of a per-tenant override, which merges. The difference
    is that one is the plan's definition and the other is an adjustment to it.
    """
    client, _, _, _, db = stack

    client.put("/admin/plans/gi_growth/limits", headers=AUTH, json={"limits": {"seats": 5}})

    deletes = [
        q
        for kind, q, _ in db.calls
        if kind == "execute" and "DELETE FROM platform.plan_limits" in q
    ]
    assert deletes, "old limits were not cleared, so the omitted key would survive"


# --- model prices (defect D7) ------------------------------------------------


def test_setting_a_model_price_deletes_its_cache_key(stack):
    """The whole of D7 in one assertion.

    Without the delete the new price is correct in the database and wrong in
    every warm instance until the TTL lapses -- which is the original defect
    wearing a different hat. The stale value is seeded first so the test fails
    if the delete is removed, rather than passing on an empty cache.
    """
    client, _, cache, _, _ = stack
    key = price_cache_key("gpt-5-mini")
    asyncio.run(cache.set(key, "0.25,2.00"))

    resp = client.put(
        "/admin/models/gpt-5-mini",
        headers=AUTH,
        json={"input_per_million_usd": "9.00", "output_per_million_usd": "1.00"},
    )

    assert resp.status_code == 200
    assert asyncio.run(cache.get(key)) is None, "stale price survived the edit"


def test_deleting_a_model_price_also_deletes_its_cache_key(stack):
    """Otherwise a removed price keeps being charged from cache."""
    client, _, cache, _, _ = stack
    key = price_cache_key("gpt-5-mini")
    asyncio.run(cache.set(key, "0.25,2.00"))

    client.delete("/admin/models/gpt-5-mini", headers=AUTH)

    assert asyncio.run(cache.get(key)) is None


def test_a_model_name_is_normalised_before_it_is_stored(stack):
    """A price saved under a spelling the recorder never looks up is invisible.

    The operator sees their edit accepted and their costs stay NULL, which is
    the same symptom as no edit at all.
    """
    client, _, _, _, _ = stack

    resp = client.put(
        "/admin/models/OpenAI:GPT-5-Mini",
        headers=AUTH,
        json={"input_per_million_usd": "1", "output_per_million_usd": "2"},
    )

    assert resp.json()["model"] == "gpt-5-mini"


def test_deleting_a_price_warns_that_spend_becomes_invisible(stack):
    """Silently returning 204 would hide that the model's cost is now NULL."""
    client, _, _, _, _ = stack

    resp = client.delete("/admin/models/gpt-5-mini", headers=AUTH)

    assert resp.status_code == 200
    assert "will not appear" in resp.json()["warning"]


def test_deleting_a_price_that_does_not_exist_is_404(stack):
    client, _, _, _, _ = stack

    assert client.delete("/admin/models/unknown", headers=AUTH).status_code == 404


# --- billing credentials ------------------------------------------------------


def test_test_connection_resets_the_provider_first(stack):
    """Otherwise it confidently reports success for a key already rotated away."""
    client, _, _, billing, _ = stack

    client.post("/admin/billing/test-connection", headers=AUTH)

    assert billing.resets == 1


def test_a_bad_stripe_key_is_a_200_with_ok_false(stack):
    """A diagnostic, not an API error.

    Raising would make "your Stripe key is wrong" indistinguishable in logs and
    alerting from "the admin API is broken", which are acted on very differently.
    """
    client, _, _, billing, _ = stack
    billing._fails = RuntimeError("Invalid API Key provided")

    resp = client.post("/admin/billing/test-connection", headers=AUTH)

    assert resp.status_code == 200
    assert resp.json()["ok"] is False


# --- everything that changes state is audited --------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body", "action"),
    [
        ("patch", "/admin/plans/gi_growth", {"name": "X"}, "plan.updated"),
        (
            "put",
            "/admin/plans/gi_growth/limits",
            {"limits": {"seats": 1}},
            "plan.limits.set",
        ),
        (
            "put",
            "/admin/models/gpt-5-mini",
            {"input_per_million_usd": "1", "output_per_million_usd": "2"},
            "model_price.set",
        ),
        ("delete", "/admin/models/gpt-5-mini", None, "model_price.deleted"),
        ("post", "/admin/billing/test-connection", None, "billing.connection_tested"),
    ],
)
def test_every_catalogue_mutation_is_audited(stack, method, path, body, action):
    """Equality on the action, never containment.

    A previous version of this suite asserted `action in recorded`, which a
    deliberately renamed `plan.updated.BREAK` still satisfied -- the test passed
    against a build with the audit broken on purpose.
    """
    client, written, _, _, _ = stack

    resp = getattr(client, method)(path, headers=AUTH, **({"json": body} if body else {}))

    assert resp.status_code == 200
    assert len(written) == 1, f"{method.upper()} {path} wrote {len(written)} audit rows"
    assert written[0][2] == action


def test_the_audit_record_excludes_the_live_subscriber_count(stack):
    """It is not part of the plan.

    Recording it would make every audit row appear to show a change whenever
    somebody subscribed, which makes the trail unreadable for the one job it
    has: showing what a human altered.
    """
    client, written, _, _, _ = stack

    client.patch("/admin/plans/gi_growth", headers=AUTH, json={"name": "X"})

    assert "subscriber_count" not in str(written[0])


def test_the_audit_record_never_contains_the_stripe_key(stack):
    """An audit log is a bad place to keep credentials."""
    client, written, _, _, _ = stack

    client.post("/admin/billing/test-connection", headers=AUTH)

    assert "sk_" not in str(written[0])
