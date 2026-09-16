"""The record of what platform operators did.

Append-only, and enforced as such by the database rather than by convention --
``zeus_app`` holds INSERT and SELECT on ``platform.admin_audit`` and is
explicitly denied UPDATE and DELETE (migration 0016). There is deliberately no
``update`` or ``delete`` method here, and adding one would fail at runtime.

Outside RLS by design: admin actions are platform-wide and belong to no tenant.
"""

from __future__ import annotations

import json
from typing import Any

from zeus_adapters.interfaces import Database

#: Written in place of any value that must not be persisted. See ``redact``.
REDACTED: dict[str, Any] = {"changed": True}


def redact(*, changed: bool = True) -> dict[str, Any]:
    """The stand-in recorded instead of a secret's value.

    An audit trail that captures the API key it was auditing becomes a second
    place that key can leak from, and it is a place nobody thinks to rotate.
    What is worth keeping is that the value changed and who changed it, which
    is exactly what this records.
    """
    return dict(REDACTED) if changed else {"changed": False}


class AuditRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def record(
        self,
        *,
        action: str,
        actor_user_id: str | None = None,
        actor_email: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> None:
        """Write one audit row.

        ``action`` is a dotted verb naming what happened -- ``setting.update``,
        ``platform_admin.grant`` -- so the log can be filtered without matching
        on prose.

        This does not swallow its own errors. An admin mutation whose audit row
        could not be written should fail loudly: a silent except here would
        produce a system that appears audited and is not, which is worse than
        one that is visibly not audited. The caller writes the audit row inside
        the same request, so a failure surfaces as a failed admin action.
        """
        await self._db.execute(
            """
            INSERT INTO platform.admin_audit
                (actor_user_id, actor_email, action, target_type, target_id,
                 before, after, ip, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)
            """,
            actor_user_id,
            actor_email,
            action,
            target_type,
            target_id,
            _json(before),
            _json(after),
            ip,
            user_agent,
        )

    async def recent(self, *, limit: int = 100) -> list[dict[str, Any]]:
        """Most recent actions first, for the admin UI built in Phase 8."""
        return await self._db.fetch(
            """
            SELECT id, actor_user_id, actor_email, action, target_type, target_id,
                   before, after, host(ip) AS ip, user_agent, created_at
            FROM platform.admin_audit
            ORDER BY created_at DESC
            LIMIT $1
            """,
            max(1, min(limit, 500)),
        )


def _json(value: dict[str, Any] | None) -> str | None:
    """asyncpg will not adapt a dict to jsonb on its own, so encode here.

    Doing it in one place means a caller cannot accidentally pass a dict
    straight through and get an unhelpful driver error at insert time.
    """
    return None if value is None else json.dumps(value)
