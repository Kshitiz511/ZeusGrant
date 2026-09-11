"""Tolerant parsing of model "JSON" output.

Even with ``response_format=json_object`` models occasionally wrap output in
markdown fences, prefix it with prose, or truncate mid-object when they hit the
token ceiling. A bare ``json.loads`` turns each of those into a 500.

This module recovers what it can and raises a single typed error when it
genuinely cannot, so callers have one thing to handle.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

log = logging.getLogger(__name__)

# ```json ... ``` or ``` ... ``` — the most common wrapper.
_FENCE = re.compile(r"```(?:json|JSON)?\s*(.*?)```", re.DOTALL)


class MalformedModelOutputError(ValueError):
    """The model returned something we could not read as JSON."""

    def __init__(self, raw: str) -> None:
        preview = raw[:400].replace("\n", " ")
        super().__init__(f"Model did not return valid JSON. Received: {preview!r}")
        self.raw = raw


def parse_json_object(raw: str) -> dict[str, Any]:
    """Parse a model response into a dict, tolerating common deviations.

    A JSON array at the top level is wrapped as ``{"items": [...]}`` so callers
    always receive a mapping.
    """
    if raw is None:
        raise MalformedModelOutputError("")

    text = raw.strip()
    if not text:
        raise MalformedModelOutputError(raw)

    for candidate in _candidates(text):
        try:
            value = json.loads(candidate)
        except (json.JSONDecodeError, ValueError):
            continue
        if isinstance(value, dict):
            return value
        if isinstance(value, list):
            return {"items": value}
        # A bare scalar is not usable output.
        continue

    raise MalformedModelOutputError(raw)


def _candidates(text: str) -> list[str]:
    """Progressively more aggressive readings of the response."""
    out = [text]

    fenced = _FENCE.search(text)
    if fenced:
        out.append(fenced.group(1).strip())

    # Prose before/after the payload: take the outermost braces or brackets.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            out.append(text[start : end + 1])

    # Truncated output (hit max_tokens): close what is still open.
    repaired = _repair_truncated(text)
    if repaired is not None:
        out.append(repaired)

    seen: set[str] = set()
    return [c for c in out if c and not (c in seen or seen.add(c))]


def _repair_truncated(text: str) -> str | None:
    """Close unterminated strings/containers in a truncated JSON document.

    Only useful when the model was cut off mid-generation; returns ``None``
    when the text does not look like a truncated object or array.
    """
    start = min(
        (i for i in (text.find("{"), text.find("[")) if i != -1),
        default=-1,
    )
    if start == -1:
        return None

    body = text[start:]
    stack: list[str] = []
    in_string = False
    escaped = False

    for ch in body:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append(ch)
        elif ch in "}]" and stack:
            stack.pop()

    if not stack and not in_string:
        return None  # Already balanced; nothing to repair.

    repaired = body
    if in_string:
        repaired += '"'
    # Drop a dangling key or comma that would make the close invalid.
    repaired = re.sub(r",\s*$", "", repaired.rstrip())
    repaired = re.sub(r",?\s*\"[^\"]*\"\s*:\s*$", "", repaired)
    for opener in reversed(stack):
        repaired += "}" if opener == "{" else "]"
    return repaired


def coerce_list(payload: dict[str, Any], *keys: str) -> list[Any]:
    """Pull a list out of a model payload whose top-level key is unpredictable.

    Models asked for ``{"obligations": [...]}`` sometimes answer
    ``{"items": [...]}``, ``{"results": [...]}`` or a bare list. Rather than
    fail on a naming difference, look through the likely keys and fall back to
    the first list-valued entry.
    """
    for key in (*keys, "items", "results", "data", "output"):
        value = payload.get(key)
        if isinstance(value, list):
            return value

    for value in payload.values():
        if isinstance(value, list):
            return value

    log.warning("No list found in model payload; keys=%s", sorted(payload))
    return []
