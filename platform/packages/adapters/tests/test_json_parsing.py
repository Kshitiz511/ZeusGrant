"""Tests for tolerant parsing of model JSON output."""

from __future__ import annotations

import pytest
from zeus_adapters.llm.json_parsing import (
    MalformedModelOutputError,
    coerce_list,
    parse_json_object,
)


def test_parses_plain_json():
    assert parse_json_object('{"a": 1}') == {"a": 1}


def test_strips_markdown_fences():
    raw = '```json\n{"obligations": [{"description": "Deliver report"}]}\n```'
    assert parse_json_object(raw)["obligations"][0]["description"] == "Deliver report"


def test_strips_unlabelled_fences():
    assert parse_json_object('```\n{"a": 1}\n```') == {"a": 1}


def test_ignores_prose_around_the_payload():
    raw = 'Here is the JSON you asked for:\n{"a": 1}\nHope that helps!'
    assert parse_json_object(raw) == {"a": 1}


def test_wraps_a_top_level_array():
    """Models sometimes answer with a bare array; callers still want a mapping."""
    assert parse_json_object('[{"description": "x"}]') == {"items": [{"description": "x"}]}


def test_repairs_output_truncated_by_the_token_limit():
    raw = '{"obligations": [{"description": "Submit the quarterly compliance report"'
    parsed = parse_json_object(raw)
    assert parsed["obligations"][0]["description"].startswith("Submit the quarterly")


def test_repairs_truncation_inside_a_string():
    raw = '{"obligations": [{"description": "Pay the invoice within 30 day'
    parsed = parse_json_object(raw)
    assert "Pay the invoice" in parsed["obligations"][0]["description"]


def test_repairs_trailing_comma_from_truncation():
    raw = '{"obligations": [{"description": "First duty"},'
    parsed = parse_json_object(raw)
    assert len(parsed["obligations"]) == 1


@pytest.mark.parametrize("raw", ["", "   ", "I cannot help with that.", "null", "42"])
def test_rejects_unusable_output(raw):
    with pytest.raises(MalformedModelOutputError):
        parse_json_object(raw)


def test_error_message_includes_a_preview_for_debugging():
    with pytest.raises(MalformedModelOutputError) as exc:
        parse_json_object("Sorry, I refuse.")
    assert "Sorry, I refuse." in str(exc.value)


def test_coerce_list_prefers_the_requested_key():
    assert coerce_list({"obligations": [1], "items": [2]}, "obligations") == [1]


def test_coerce_list_falls_back_to_common_aliases():
    assert coerce_list({"results": [1, 2]}, "obligations") == [1, 2]


def test_coerce_list_falls_back_to_any_list_value():
    """A naming difference should not cost us the whole extraction."""
    assert coerce_list({"contract_duties": [1]}, "obligations") == [1]


def test_coerce_list_returns_empty_when_there_is_no_list():
    assert coerce_list({"message": "none found"}, "obligations") == []
