"""The overlay that turns stored config strings into live Settings values."""

from __future__ import annotations

from pydantic import SecretStr
from zeus_config import Settings
from zeus_platform_core.container import _overlay


def test_optional_secret_field_is_wrapped_not_stored_as_plain_text():
    # openai_api_key defaults to None; coercing against the *value* rather than
    # the annotation would store a bare str and leak it in reprs and logs.
    s = _overlay(Settings(), {"llm.openai_api_key": "sk-live-123"})
    value = s.llm.openai_api_key
    assert isinstance(value, SecretStr)
    assert value.get_secret_value() == "sk-live-123"
    assert "sk-live-123" not in repr(s.llm)


def test_plain_string_field_is_applied():
    s = _overlay(Settings(), {"llm.model": "gpt-5-mini"})
    assert s.llm.model == "gpt-5-mini"


def test_numeric_field_is_coerced_from_string():
    s = _overlay(Settings(), {"llm.timeout_seconds": "42"})
    assert s.llm.timeout_seconds == 42


def test_bad_value_is_skipped_rather_than_raising():
    # A typo in the dashboard must not brick every request.
    s = _overlay(Settings(), {"llm.timeout_seconds": "not-a-number"})
    assert s.llm.timeout_seconds == Settings().llm.timeout_seconds


def test_unknown_path_is_ignored():
    s = _overlay(Settings(), {"llm.nope": "x", "nosuchgroup.field": "y"})
    assert isinstance(s, Settings)


def test_original_settings_are_not_mutated():
    base = Settings()
    _overlay(base, {"llm.model": "changed"})
    assert base.llm.model != "changed"


def test_empty_overrides_returns_the_same_object():
    base = Settings()
    assert _overlay(base, {}) is base
