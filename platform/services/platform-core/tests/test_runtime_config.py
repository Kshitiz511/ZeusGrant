"""Admin-managed runtime config: resolution order, caching and the catalogue."""

from __future__ import annotations

from typing import get_args

import pytest
from pydantic import BaseModel
from zeus_config.settings import Settings
from zeus_platform_core.services.runtime_config import (
    BOOTSTRAP_ENV_VARS,
    CACHE_PREFIX,
    MANAGED_KEYS,
    RuntimeConfigService,
    UnknownConfigKey,
    managed_key,
)


class FakeCache:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.gets = 0

    async def get(self, key: str) -> str | None:
        self.gets += 1
        return self.data.get(key)

    async def set(self, key: str, value: str, *, ttl_seconds: int | None = None) -> None:
        self.data[key] = value

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)

    async def invalidate(self, pattern: str) -> int:
        return 0


class FakeConfigRepo:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.reads = 0

    async def get(self, key: str) -> str | None:
        self.reads += 1
        return self.data.get(key)

    async def set(self, key, value, *, is_secret=False, updated_by=None) -> None:
        self.data[key] = value

    async def delete(self, key: str) -> None:
        self.data.pop(key, None)


def build(env: dict[str, str] | None = None):
    repo = FakeConfigRepo()
    cache = FakeCache()
    svc = RuntimeConfigService(config=repo, cache=cache, env=env or {})
    return svc, repo, cache


@pytest.mark.asyncio
async def test_database_value_wins_over_environment():
    svc, repo, _ = build({"ZEUS_OPENAI_API_KEY": "from-env"})
    await svc.set("llm.openai_api_key", "from-db")
    assert await svc.get("llm.openai_api_key") == "from-db"


@pytest.mark.asyncio
async def test_environment_is_the_fallback_floor():
    svc, _, _ = build({"ZEUS_OPENAI_API_KEY": "from-env"})
    assert await svc.get("llm.openai_api_key") == "from-env"


@pytest.mark.asyncio
async def test_unset_everywhere_is_none():
    svc, _, _ = build()
    assert await svc.get("llm.openai_api_key") is None


@pytest.mark.asyncio
async def test_absence_is_cached_so_env_only_keys_do_not_hit_the_database():
    # Without a negative-cache sentinel this would be a query per request.
    svc, repo, _ = build({"ZEUS_LLM_MODEL": "gpt-5-mini"})
    for _ in range(3):
        assert await svc.get("llm.model") == "gpt-5-mini"
    assert repo.reads == 1


@pytest.mark.asyncio
async def test_write_invalidates_the_cache_immediately():
    svc, _, cache = build()
    await svc.set("llm.model", "a")
    assert await svc.get("llm.model") == "a"
    await svc.set("llm.model", "b")
    assert CACHE_PREFIX + "llm.model" not in cache.data
    assert await svc.get("llm.model") == "b"


@pytest.mark.asyncio
async def test_clear_restores_the_environment_value():
    svc, _, _ = build({"ZEUS_LLM_MODEL": "gpt-5-mini"})
    await svc.set("llm.model", "override")
    assert await svc.get("llm.model") == "override"
    await svc.clear("llm.model")
    assert await svc.get("llm.model") == "gpt-5-mini"


@pytest.mark.asyncio
async def test_unknown_keys_are_rejected_rather_than_stored():
    svc, repo, _ = build()
    with pytest.raises(UnknownConfigKey):
        await svc.set("llm.some_typo", "x")
    assert repo.data == {}


@pytest.mark.asyncio
async def test_empty_value_is_rejected():
    svc, _, _ = build()
    with pytest.raises(ValueError, match="delete it instead"):
        await svc.set("llm.model", "   ")


def test_bootstrap_settings_are_not_managed():
    # Storing these in the store they unlock would be circular.
    #
    # Asserting over the whole BOOTSTRAP_ENV_VARS set rather than a hand-written
    # list means adding a bootstrap variable is automatically covered. The old
    # version listed names inline, which is how ZEUS_JWT_SECRET -- a variable
    # that does not exist -- sat in the set passing a test for years (D14).
    env_vars = {k.env_var for k in MANAGED_KEYS}
    assert env_vars.isdisjoint(BOOTSTRAP_ENV_VARS)


def test_bootstrap_env_vars_are_real_settings():
    """Every bootstrap name must correspond to an actual settings alias.

    A guard listing a variable nobody reads protects nothing while looking as
    though it does. This is the check that would have caught D14, where the set
    named ``ZEUS_JWT_SECRET`` and the real field was ``ZEUS_SUPABASE_JWT_SECRET``.

    The walk is over the model *classes*, not an instance, so it needs no
    environment and cannot be made to pass by whatever happens to be exported.
    """
    aliases: set[str] = set()
    seen: set[type] = set()

    def walk(model: type[BaseModel]) -> None:
        if model in seen:
            return
        seen.add(model)
        for field in model.model_fields.values():
            if field.alias:
                aliases.add(field.alias)
            for arg in (field.annotation, *get_args(field.annotation)):
                if isinstance(arg, type) and issubclass(arg, BaseModel):
                    walk(arg)

    walk(Settings)
    assert aliases >= BOOTSTRAP_ENV_VARS, f"not real settings: {BOOTSTRAP_ENV_VARS - aliases}"


def test_secrets_are_flagged_so_they_are_encrypted_and_never_echoed():
    assert managed_key("llm.openai_api_key").is_secret is True
    assert managed_key("billing.stripe_secret_key").is_secret is True
    assert managed_key("billing.stripe_webhook_secret").is_secret is True


@pytest.mark.asyncio
async def test_status_reports_provenance_without_leaking_secrets():
    svc, _, _ = build({"ZEUS_LLM_MODEL": "gpt-5-mini"})
    await svc.set("llm.openai_api_key", "sk-super-secret")
    by_key = {s.key: s for s in await svc.status()}

    assert by_key["llm.openai_api_key"].source == "database"
    assert by_key["llm.openai_api_key"].preview is None

    assert by_key["llm.model"].source == "environment"
    assert by_key["llm.model"].preview == "gpt-5-mini"

    assert by_key["billing.stripe_secret_key"].source == "unset"

    rendered = repr(await svc.status())
    assert "sk-super-secret" not in rendered
