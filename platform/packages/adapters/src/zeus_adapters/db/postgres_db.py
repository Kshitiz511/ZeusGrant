"""asyncpg implementation of :class:`Database`.

A thin wrapper around an asyncpg pool that returns plain dicts so callers
never depend on driver-specific record types. Query strings live in the
repositories; this class only executes them.
"""

from __future__ import annotations

from typing import Any

from zeus_adapters.interfaces import Database


class PostgresDatabase(Database):
    def __init__(self, *, dsn: str, min_size: int = 1, max_size: int = 10) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._pool: Any | None = None

    async def connect(self) -> None:
        if self._pool is not None:
            return
        try:
            import asyncpg
        except ImportError as exc:  # pragma: no cover
            raise ImportError(
                "Postgres database selected but asyncpg not installed. Install with "
                "`uv pip install 'zeus-adapters[postgres]'`."
            ) from exc
        self._pool = await asyncpg.create_pool(
            dsn=self._dsn, min_size=self._min_size, max_size=self._max_size
        )

    async def disconnect(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    def _require_pool(self) -> Any:
        if self._pool is None:
            raise RuntimeError("Database pool is not connected. Call connect() first.")
        return self._pool

    # --- tenant-aware execution -------------------------------------------
    # When the request context has a tenant bound (see tenant_context.py) we
    # run the query inside a transaction with `app.current_tenant` pinned via
    # set_config(..., is_local=true) so Postgres RLS policies apply and the
    # setting can never leak across pooled connections. When no tenant is
    # bound (platform-level queries, migrations, jobs) we run directly.

    async def _run(self, method: str, query: str, *args: Any) -> Any:
        from zeus_adapters.db.tenant_context import get_bound_tenant

        pool = self._require_pool()
        tenant = get_bound_tenant()
        if tenant is None:
            return await getattr(pool, method)(query, *args)
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "SELECT set_config('app.current_tenant', $1, true)", tenant
                )
                return await getattr(conn, method)(query, *args)

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        rows = await self._run("fetch", query, *args)
        return [dict(r) for r in rows]

    async def fetch_one(self, query: str, *args: Any) -> dict[str, Any] | None:
        row = await self._run("fetchrow", query, *args)
        return dict(row) if row is not None else None

    async def execute(self, query: str, *args: Any) -> str:
        return await self._run("execute", query, *args)
