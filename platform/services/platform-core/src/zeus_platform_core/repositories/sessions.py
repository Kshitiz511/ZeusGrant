"""Persistence for refresh-token sessions.

Only hashes are ever written here; see ``0005_sessions.sql`` for the reasoning
behind the token-hash and rotation-family design.
"""

from __future__ import annotations

from datetime import datetime

from zeus_adapters.interfaces import Database


class SessionRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def create(
        self,
        *,
        session_id: str,
        family_id: str,
        user_id: str,
        token_hash: str,
        csrf_hash: str,
        expires_at: datetime,
        user_agent: str | None = None,
        ip: str | None = None,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.user_sessions
                (id, family_id, user_id, token_hash, csrf_hash, expires_at, user_agent, ip)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet)
            """,
            session_id,
            family_id,
            user_id,
            token_hash,
            csrf_hash,
            expires_at,
            user_agent,
            ip,
        )

    async def get_by_token_hash(self, token_hash: str) -> dict | None:
        return await self._db.fetch_one(
            """
            SELECT id, family_id, user_id, csrf_hash, expires_at, used_at, revoked_at
            FROM platform.user_sessions
            WHERE token_hash = $1
            """,
            token_hash,
        )

    async def claim(self, session_id: str) -> bool:
        """Atomically mark a session as used; ``False`` if it already was.

        The ``used_at IS NULL`` predicate is the concurrency guard: if two
        refreshes race on the same cookie, exactly one UPDATE matches a row and
        the loser is treated as a reuse attempt rather than both being handed
        fresh sessions.
        """
        row = await self._db.fetch_one(
            """
            UPDATE platform.user_sessions
            SET used_at = now()
            WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
            RETURNING id
            """,
            session_id,
        )
        return row is not None

    async def revoke_family(self, family_id: str, reason: str) -> None:
        """Kill every live session descended from one login."""
        await self._db.execute(
            """
            UPDATE platform.user_sessions
            SET revoked_at = now(), revoked_reason = $2
            WHERE family_id = $1 AND revoked_at IS NULL
            """,
            family_id,
            reason,
        )

    async def delete_expired(self) -> None:
        """Housekeeping: drop rows that can no longer authenticate anyone."""
        await self._db.execute(
            "DELETE FROM platform.user_sessions WHERE expires_at < now() - interval '30 days'"
        )
