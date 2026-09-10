"""AI obligation extraction.

Turns raw contract text into structured obligations using the pluggable
:class:`LlmProvider` and the active, admin-editable prompt from the shared
prompt registry (`platform.prompt_registry`). No prompt is hardcoded here —
it is fetched live so it can be tuned without a deploy.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from zeus_adapters.interfaces import Database, LlmProvider

from zeus_contract_compliance.domain import ObligationDraft, ObligationPriority

PROMPT_NAME = "contract.extract_obligations"

_FALLBACK_INSTRUCTIONS = (
    "You are a contract compliance analyst. Extract every concrete obligation, "
    "deliverable or deadline from the contract text. Return JSON only."
)

# The JSON shape we ask the model to fill.
_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "obligations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "description": {"type": "string"},
                    "due_date": {"type": "string", "description": "ISO date or null"},
                    "responsible": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": ["description"],
            },
        }
    },
    "required": ["obligations"],
}


class ExtractionService:
    def __init__(self, *, llm: LlmProvider, db: Database) -> None:
        self._llm = llm
        self._db = db

    async def _active_prompt(self) -> str:
        row = await self._db.fetch_one(
            "SELECT body FROM platform.prompt_registry "
            "WHERE name = $1 AND is_active LIMIT 1",
            PROMPT_NAME,
        )
        return row["body"] if row and row.get("body") else _FALLBACK_INSTRUCTIONS

    async def extract(self, contract_body: str) -> list[ObligationDraft]:
        if not contract_body or not contract_body.strip():
            return []
        instructions = await self._active_prompt()
        result = await self._llm.extract(
            _SCHEMA, contract_body, instructions=instructions
        )
        return [_to_draft(item) for item in result.get("obligations", []) if item]


def _to_draft(item: dict[str, Any]) -> ObligationDraft:
    return ObligationDraft(
        description=str(item.get("description", "")).strip() or "(unspecified obligation)",
        due_date=_parse_date(item.get("due_date")),
        responsible=(item.get("responsible") or None),
        priority=_parse_priority(item.get("priority")),
    )


def _parse_date(value: Any) -> date | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _parse_priority(value: Any) -> ObligationPriority:
    try:
        return ObligationPriority(str(value).lower())
    except ValueError:
        return ObligationPriority.medium
