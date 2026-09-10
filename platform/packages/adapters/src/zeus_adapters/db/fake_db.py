"""In-memory :class:`Database` stub for tests and local bootstrap.

Backed by a scripted response map so repository/domain code can be exercised
without a live Postgres. Not a real SQL engine; it matches queries by a
registered handler keyed on a substring of the query.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

Handler = Callable[[tuple[Any, ...]], Any]


class FakeDatabase:
    def __init__(self) -> None:
        self._fetch: list[tuple[str, Handler]] = []
        self._fetch_one: list[tuple[str, Handler]] = []
        self._execute: list[tuple[str, Handler]] = []
        self.calls: list[tuple[str, str, tuple[Any, ...]]] = []

    # --- registration helpers (test-side) ---
    def on_fetch(self, needle: str, handler: Handler) -> None:
        self._fetch.append((needle, handler))

    def on_fetch_one(self, needle: str, handler: Handler) -> None:
        self._fetch_one.append((needle, handler))

    def on_execute(self, needle: str, handler: Handler) -> None:
        self._execute.append((needle, handler))

    @staticmethod
    def _match(table: list[tuple[str, Handler]], query: str, args: tuple[Any, ...]) -> Any:
        for needle, handler in table:
            if needle in query:
                return handler(args)
        return None

    # --- Database interface ---
    async def connect(self) -> None:  # noqa: D401
        return None

    async def disconnect(self) -> None:
        return None

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        self.calls.append(("fetch", query, args))
        return self._match(self._fetch, query, args) or []

    async def fetch_one(self, query: str, *args: Any) -> dict[str, Any] | None:
        self.calls.append(("fetch_one", query, args))
        return self._match(self._fetch_one, query, args)

    async def execute(self, query: str, *args: Any) -> str:
        self.calls.append(("execute", query, args))
        result = self._match(self._execute, query, args)
        return result if isinstance(result, str) else "OK"
