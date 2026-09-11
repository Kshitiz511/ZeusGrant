"""Tests for configuration guards that protect production.

Each of these settings fails *silently* if it is wrong — a default JWT secret
still signs tokens, and /dev/token still mints them. The point of these tests is
that a misconfigured production process refuses to start instead.

Settings are driven through real environment variables because the nested
groups (auth, storage, billing) each read the environment themselves; passing
kwargs to the root ``Settings`` would not populate them, and the test would
prove nothing about how the service actually boots.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError
from zeus_config.settings import Environment, Settings

# Variables that could leak in from the developer's shell and make these
# assertions lie.
_RELEVANT = (
    "ZEUS_ENV",
    "ZEUS_DEV_TOKENS",
    "ZEUS_SUPABASE_JWT_SECRET",
    "ZEUS_SECRETS_ENCRYPTION_KEY",
    "ZEUS_SESSION_COOKIE_SECURE",
)


@pytest.fixture
def env(monkeypatch):
    """Return a builder that loads Settings from a controlled environment."""
    for name in _RELEVANT:
        monkeypatch.delenv(name, raising=False)

    def apply(**values: str) -> Settings:
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        # _env_file=None so a developer's local .env cannot reintroduce secrets.
        return Settings(_env_file=None)

    return apply


def test_dev_tokens_allowed_in_development(env):
    settings = env(ZEUS_ENV="development", ZEUS_DEV_TOKENS="true")
    assert settings.dev_tokens_enabled
    assert not settings.is_production


def test_dev_tokens_in_production_refuse_to_start(env):
    """A full authentication bypass must never be a runtime surprise."""
    with pytest.raises(ValidationError, match="ZEUS_DEV_TOKENS"):
        env(
            ZEUS_ENV="production",
            ZEUS_DEV_TOKENS="true",
            ZEUS_SUPABASE_JWT_SECRET="a-real-secret",
            ZEUS_SECRETS_ENCRYPTION_KEY="a-real-key",
        )


def test_production_requires_a_jwt_secret(env):
    with pytest.raises(ValidationError, match="ZEUS_SUPABASE_JWT_SECRET"):
        env(ZEUS_ENV="production", ZEUS_SECRETS_ENCRYPTION_KEY="a-real-key")


def test_production_requires_a_secrets_encryption_key(env):
    with pytest.raises(ValidationError, match="ZEUS_SECRETS_ENCRYPTION_KEY"):
        env(ZEUS_ENV="production", ZEUS_SUPABASE_JWT_SECRET="a-real-secret")


def test_production_error_names_every_missing_secret(env):
    """One restart per missing variable is a miserable way to deploy."""
    with pytest.raises(ValidationError) as exc:
        env(ZEUS_ENV="production")
    message = str(exc.value)
    assert "ZEUS_SUPABASE_JWT_SECRET" in message
    assert "ZEUS_SECRETS_ENCRYPTION_KEY" in message


def test_fully_configured_production_starts(env):
    settings = env(
        ZEUS_ENV="production",
        ZEUS_SUPABASE_JWT_SECRET="a-real-secret",
        ZEUS_SECRETS_ENCRYPTION_KEY="a-real-key",
    )
    assert settings.is_production
    assert settings.env is Environment.production
    # Defaults to off, and the validator above proves it cannot be turned on.
    assert not settings.dev_tokens_enabled


def test_development_does_not_require_production_secrets(env):
    """Local development must stay zero-config."""
    settings = env(ZEUS_ENV="development")
    assert not settings.is_production


def test_session_cookie_is_insecure_only_in_development(env):
    """Plain-HTTP localhost needs a non-Secure cookie; nothing else does."""
    settings = env(ZEUS_ENV="development")
    assert settings.session.cookie_secure is False
    assert settings.session.cookie_name == "zeus_session"


def test_production_forces_secure_session_cookies(env):
    """An explicit ``false`` must not be honoured in production.

    Unlike the missing-secret cases this overrides rather than refuses: the
    flag is only ever off for local HTTP, and turning it on cannot break a
    correctly deployed HTTPS site, whereas leaving it off would leak the
    refresh token over plaintext.
    """
    settings = env(
        ZEUS_ENV="production",
        ZEUS_SESSION_COOKIE_SECURE="false",
        ZEUS_SUPABASE_JWT_SECRET="a-real-secret",
        ZEUS_SECRETS_ENCRYPTION_KEY="a" * 32,
    )
    assert settings.session.cookie_secure is True
