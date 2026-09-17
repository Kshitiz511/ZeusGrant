"""Phase 5c: bounded managed settings, live TTLs, cache flush, key rotation.

Four guarantees, and the reason each one is here rather than a comment.

**Bounds are enforced, not documented.** Several managed keys are cache
lifetimes for authorisation decisions. An admin who types 86400 into the
membership TTL has given everyone removed from a workspace another day of
access, and nothing else in the system would notice. A number typed into a text
box must not be able to do that.

**Bounds are enforced on read as well as write.** Enforcing only on write means
the one value that matters -- the one actually in use -- is the one never
checked. Bounds get tightened, tables get edited by hand, and backups get
restored.

**TTLs are read per use, not captured at construction.** These services are
cached properties on a container that outlives every request. A value read once
at boot is pinned until the instance recycles, which is the shape of defect D7
and of D18.

**Settings refresh on the request path.** They did not. ``startup()`` resolved
the overlay once and nothing ever called it again, so an admin edit reached the
single instance that served the write and no other (D18).
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from zeus_adapters.cache.memory_cache import MemoryCache
from zeus_adapters.db.fake_db import FakeDatabase
from zeus_adapters.models import Session
from zeus_config.secrets import SecretBox
from zeus_config.settings import Settings
from zeus_platform_core.app import create_app
from zeus_platform_core.container import Container
from zeus_platform_core.routers.admin import FLUSHABLE_PREFIXES
from zeus_platform_core.security import PLATFORM_ADMIN_ROLE
from zeus_platform_core.services.entitlements_service import EntitlementsService
from zeus_platform_core.services.runtime_config import (
    MANAGED_KEYS,
    ManagedKey,
    RuntimeConfigService,
    managed_key,
)
from zeus_service_kit.metering import AiUsageRecorder

TENANT = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
AUTH = {"Authorization": "Bearer good-token"}

NUMERIC = [k for k in MANAGED_KEYS if k.value_type in {"int", "float"}]


class StubAuth:
    def __init__(self, roles: list[str]) -> None:
        self._roles = roles

    async def verify(self, token: str) -> Session:
        if token != "good-token":
            raise ValueError("bad token")
        return Session(user_id=USER, email=None, tenant_id=TENANT, roles=list(self._roles))

    async def issue_claims(self, user_id: str, tenant_id: str, roles: list[str]) -> str:
        return "token"


class FakeConfigRepo:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.data.get(key)

    async def set(self, key, value, *, is_secret=False, updated_by=None) -> None:
        self.data[key] = value

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


def _svc(env: dict[str, str] | None = None):
    repo = FakeConfigRepo()
    return RuntimeConfigService(config=repo, cache=MemoryCache(), env=env or {}), repo


# --- 1. every numeric key is bounded -----------------------------------------


@pytest.mark.parametrize("spec", NUMERIC, ids=lambda s: s.key)
def test_every_numeric_managed_key_declares_bounds(spec: ManagedKey):
    """A structural check, so a new key cannot be added without a range.

    This is the test that makes the guardrail real. The parametrised bound
    tests below can only cover keys somebody remembered to think about; this
    asserts nobody can add an unbounded number to the registry at all.
    """
    assert spec.minimum is not None, f"{spec.key} has no lower bound"
    assert spec.maximum is not None, f"{spec.key} has no upper bound"
    assert spec.minimum < spec.maximum


@pytest.mark.parametrize("spec", NUMERIC, ids=lambda s: s.key)
def test_bounds_admit_the_deployed_default(spec: ManagedKey):
    """A bound that excludes the shipped default would be a bound nobody could satisfy.

    Catches the transposed-digit mistake where a range is written round the
    wrong way, or tightened past the value the platform is actually running on.
    """
    group_name, _, field = (spec.settings_path or "").partition(".")
    group = getattr(Settings(), group_name, None)
    if group is None or field not in type(group).model_fields:
        pytest.skip(f"{spec.key} has no settings field to compare against")
    default = getattr(group, field)
    assert spec.minimum <= float(default) <= spec.maximum, (
        f"{spec.key} default {default} is outside its own bounds"
    )


def test_the_authorization_caches_are_capped_in_minutes_not_hours():
    """Named explicitly, because this is the bound with teeth.

    A long membership TTL is not a performance setting, it is how long a
    removed colleague keeps reading a workspace. Asserting the exact ceiling
    means loosening it has to be a deliberate edit to this line.
    """
    assert managed_key("cache.membership_ttl_seconds").maximum == 300
    assert managed_key("cache.entitlements_ttl_seconds").maximum == 900


def test_the_config_cache_ttl_is_not_itself_managed():
    """It cannot be. Resolving it would mean reading the store it governs.

    Same circularity that keeps the database URL out of the registry. Asserted
    so that a later attempt to "finish the job" by adding it is caught here,
    where the reason is written down, rather than as a puzzling recursion.
    """
    keys = {k.key for k in MANAGED_KEYS}
    assert "cache.config_ttl_seconds" not in keys
    assert not any("cfg" in k for k in keys)


# --- 2. bounds are enforced on write -----------------------------------------


@pytest.mark.asyncio
async def test_a_value_above_the_ceiling_is_refused():
    svc, repo = _svc()

    with pytest.raises(ValueError, match="at most 300"):
        await svc.set("cache.membership_ttl_seconds", "86400")

    assert repo.data == {}, "the rejected value must not reach the database"


@pytest.mark.asyncio
async def test_a_value_below_the_floor_is_refused():
    svc, _ = _svc()

    with pytest.raises(ValueError, match="at least 10"):
        await svc.set("cache.membership_ttl_seconds", "0")


@pytest.mark.asyncio
async def test_the_refusal_names_the_accepted_range():
    """An operator told only 'invalid' will guess again."""
    svc, _ = _svc()

    with pytest.raises(ValueError) as exc:
        await svc.set("llm.max_attempts", "99")

    assert "at most 10" in str(exc.value)


@pytest.mark.asyncio
async def test_text_in_a_numeric_key_is_refused():
    svc, _ = _svc()

    with pytest.raises(ValueError, match="expects int"):
        await svc.set("llm.timeout_seconds", "sixty")


@pytest.mark.asyncio
async def test_a_value_inside_the_range_is_accepted():
    svc, repo = _svc()

    await svc.set("cache.membership_ttl_seconds", "120")

    assert repo.data["cache.membership_ttl_seconds"] == "120"


@pytest.mark.asyncio
async def test_a_string_key_is_unaffected_by_bounds_checking():
    """Most keys are opaque strings and must stay that way."""
    svc, repo = _svc()

    await svc.set("llm.model", "gpt-5-mini")

    assert repo.data["llm.model"] == "gpt-5-mini"


# --- 3. bounds are enforced on read ------------------------------------------


@pytest.mark.asyncio
async def test_an_out_of_bounds_stored_value_is_ignored_in_favour_of_the_environment():
    """The path that write-time validation cannot cover.

    Bounds get tightened, rows get edited by hand, backups get restored. If the
    only check is on write then the value actually in use is the one value
    never checked.
    """
    svc, repo = _svc({"ZEUS_CACHE_MEMBERSHIP_TTL_SECONDS": "60"})
    repo.data["cache.membership_ttl_seconds"] = "86400"  # as if written before the bound

    assert await svc.get("cache.membership_ttl_seconds") == "60"


@pytest.mark.asyncio
async def test_a_bad_stored_value_does_not_raise_on_the_read_path():
    """It runs on every request. A bad row must degrade, not take the site down."""
    svc, repo = _svc()
    repo.data["llm.timeout_seconds"] = "not-a-number"

    assert await svc.get("llm.timeout_seconds") is None


# --- 4. TTLs are live, not frozen at construction ----------------------------


def test_the_entitlements_ttl_is_read_at_write_time_not_construction():
    """A value captured in __init__ is pinned until the instance recycles.

    That is the shape of D7 and D18 both. The provider is called per write, so
    an admin lowering the TTL applies to the very next refresh.
    """
    cache = MemoryCache()
    ttl = {"value": 300}
    db = FakeDatabase()
    db.on_fetch("FROM platform.subscriptions", lambda args: [])
    db.on_fetch("FROM platform.plan_limits", lambda args: [])
    db.on_fetch_one(
        "FROM platform.tenants",
        lambda args: {
            "id": TENANT,
            "name": "Probe",
            "slug": "probe",
            "owner_user_id": USER,
            "status": "active",
        },
    )
    db.on_fetch("FROM platform.tenant_limit_overrides", lambda args: [])

    from zeus_platform_core.repositories.billing import (
        EntitlementRepository,
        SubscriptionRepository,
    )
    from zeus_platform_core.repositories.plans import PlanRepository
    from zeus_platform_core.repositories.tenants import TenantRepository

    recorded: list[int | None] = []
    real_set = cache.set

    async def spy(key, value, *, ttl_seconds=None):
        recorded.append(ttl_seconds)
        await real_set(key, value, ttl_seconds=ttl_seconds)

    cache.set = spy  # type: ignore[method-assign]

    svc = EntitlementsService(
        subscriptions=SubscriptionRepository(db),
        plans=PlanRepository(db),
        entitlements=EntitlementRepository(db),
        tenants=TenantRepository(db),
        cache=cache,
        ttl_seconds=lambda: ttl["value"],
    )

    asyncio.run(svc.refresh(TENANT))
    ttl["value"] = 30
    asyncio.run(svc.refresh(TENANT))

    assert recorded == [300, 30], "the TTL was captured once instead of read per write"


def test_the_model_price_ttl_is_read_at_write_time_not_construction():
    cache = MemoryCache()
    ttl = {"value": 900}
    db = FakeDatabase()
    db.on_fetch_one(
        "FROM platform.model_pricing",
        lambda args: {"input_per_million_usd": "1", "output_per_million_usd": "1"},
    )

    recorded: list[int | None] = []
    real_set = cache.set

    async def spy(key, value, *, ttl_seconds=None):
        recorded.append(ttl_seconds)
        await real_set(key, value, ttl_seconds=ttl_seconds)

    cache.set = spy  # type: ignore[method-assign]
    recorder = AiUsageRecorder(db, cache, ttl_seconds=lambda: ttl["value"])

    asyncio.run(recorder.price_for("a"))
    ttl["value"] = 60
    asyncio.run(recorder.price_for("b"))

    assert recorded == [900, 60]


# --- 5. the app wiring -------------------------------------------------------


def _db() -> FakeDatabase:
    db = FakeDatabase()
    db.on_fetch_one("is_platform_admin", lambda args: {"is_platform_admin": True})
    db.on_fetch_one(
        "email_verified_at FROM platform.users",
        lambda args: {"id": USER, "email": "ops@example.com", "full_name": None},
    )
    return db


class StubBilling:
    def __init__(self) -> None:
        self.resets = 0

    def reset_provider(self) -> None:
        self.resets += 1


@pytest.fixture
def stack() -> Iterator[tuple[TestClient, list[tuple], MemoryCache, StubBilling, Container]]:
    cache = MemoryCache()
    billing = StubBilling()
    db = _db()
    container = Container(db=db, cache=cache, auth=StubAuth([PLATFORM_ADMIN_ROLE]))
    container.__dict__["billing"] = billing
    # Both billing keys are secrets, so writing one needs a box. Supplying a
    # throwaway key here rather than reading ZEUS_SECRETS_ENCRYPTION_KEY keeps
    # the test from passing on a developer machine that happens to export one
    # and failing on a clean CI runner that does not.
    container.__dict__["secret_box"] = SecretBox(SecretBox.generate_key())

    written: list[tuple] = []
    real_execute = db.execute

    async def capture(query: str, *args):
        if "admin_audit" in query:
            written.append(args)
        return await real_execute(query, *args)

    db.execute = capture  # type: ignore[method-assign]
    yield TestClient(create_app(container)), written, cache, billing, container


def test_settings_are_refreshed_on_the_request_path(stack):
    """Defect D18.

    ``startup()`` resolved the overlay once and nothing called it again, so a
    warm instance served its boot-time settings for as long as it lived. On
    serverless that is indefinite: an admin edit reached whichever instance
    handled the write and no other.
    """
    client, _, _, _, container = stack
    calls = {"n": 0}
    real = container.effective_settings

    async def counting():
        calls["n"] += 1
        return await real()

    container.effective_settings = counting  # type: ignore[method-assign]

    client.get("/admin/cache/prefixes", headers=AUTH)
    client.get("/admin/cache/prefixes", headers=AUTH)

    assert calls["n"] == 2, "settings were not re-resolved on the request path"


# --- 6. cache flush ----------------------------------------------------------


def test_an_unknown_prefix_is_refused(stack):
    client, _, _, _, _ = stack

    resp = client.post("/admin/cache/flush", headers=AUTH, json={"prefix": "session:"})

    assert resp.status_code == 400
    assert "not a flushable" in resp.json()["detail"]


def test_a_wildcard_cannot_be_flushed(stack):
    """The reason the allowlist exists at all.

    ``invalidate`` takes a glob. A caller who could send ``*`` would clear
    sessions, entitlements and OAuth state in one request and sign out every
    user of the platform. No operational need is served by the wildcard that a
    targeted prefix does not serve, so it is simply unreachable.
    """
    client, _, _, _, _ = stack

    for attempt in ("*", "", "entitlements:*", "cfg:*"):
        resp = client.post("/admin/cache/flush", headers=AUTH, json={"prefix": attempt})
        assert resp.status_code == 400, f"{attempt!r} was accepted"


def test_flushing_removes_only_the_named_prefix(stack):
    """A flush that took neighbouring keys with it would be worse than none.

    The count is not asserted exactly: the settings-refresh middleware primes
    ``cfg:`` on every request, so the number is a property of how many managed
    keys exist rather than of the flush. What matters is that the named prefix
    went and the others did not.
    """
    client, _, cache, _, _ = stack
    asyncio.run(cache.set("cfg:llm.model", "gpt-5-mini"))
    asyncio.run(cache.set("entitlements:" + TENANT, "{}"))
    asyncio.run(cache.set("membership:" + USER, "1"))

    resp = client.post("/admin/cache/flush", headers=AUTH, json={"prefix": "cfg:"})

    assert resp.json()["keys_removed"] >= 1
    assert asyncio.run(cache.get("cfg:llm.model")) is None
    assert asyncio.run(cache.get("entitlements:" + TENANT)) is not None
    assert asyncio.run(cache.get("membership:" + USER)) is not None


def test_the_flush_reports_how_many_keys_went(stack):
    """'It worked' and 'there was nothing there' are different answers."""
    client, _, _, _, _ = stack

    resp = client.post("/admin/cache/flush", headers=AUTH, json={"prefix": "membership:"})

    assert resp.status_code == 200
    assert resp.json()["keys_removed"] == 0


def test_the_flush_is_audited(stack):
    client, written, _, _, _ = stack

    client.post("/admin/cache/flush", headers=AUTH, json={"prefix": "cfg:"})

    assert len(written) == 1
    assert written[0][2] == "cache.flushed"


def test_every_flushable_prefix_states_its_consequence(stack):
    """The person reaching for this is usually doing so under pressure."""
    client, _, _, _, _ = stack

    listed = client.get("/admin/cache/prefixes", headers=AUTH).json()["prefixes"]

    assert {p["prefix"] for p in listed} == set(FLUSHABLE_PREFIXES)
    assert all(p["consequence"].strip() for p in listed)


# --- 7. Stripe key rotation --------------------------------------------------


def test_rotating_a_billing_key_resets_the_cached_provider(stack):
    """The 8.5 gap.

    The Stripe client is built once and held for the life of the container.
    Updating the overlay changed the value and left every later charge going
    through a client holding the revoked credential, for as long as the
    instance stayed warm.
    """
    client, _, _, billing, _ = stack

    resp = client.put(
        "/admin/settings/billing.stripe_secret_key", headers=AUTH, json={"value": "sk_live_new"}
    )

    assert resp.status_code == 200
    assert billing.resets == 1


def test_clearing_a_billing_key_also_resets_the_provider(stack):
    """Reverting to the environment value is a rotation too."""
    client, _, _, billing, _ = stack

    client.delete("/admin/settings/billing.stripe_webhook_secret", headers=AUTH)

    assert billing.resets == 1


def test_an_unrelated_setting_does_not_churn_the_provider(stack):
    """Rebuilding a Stripe client on every model-name edit would be waste."""
    client, _, _, billing, _ = stack

    client.put("/admin/settings/llm.model", headers=AUTH, json={"value": "gpt-5-mini"})

    assert billing.resets == 0


def test_an_out_of_range_setting_is_refused_with_422_not_500(stack):
    """The operator needs to be told what to type, not shown a stack trace."""
    client, _, _, _, _ = stack

    resp = client.put(
        "/admin/settings/cache.membership_ttl_seconds", headers=AUTH, json={"value": "86400"}
    )

    assert resp.status_code == 422
    assert "at most 300" in resp.json()["detail"]
