"""Request-scoped tenant binding for row-level security.

The web layer (service-kit guards) binds the authenticated tenant into a
``ContextVar``; the Postgres adapter reads it and pins ``app.current_tenant``
on the connection for the duration of each query. Postgres RLS policies then
enforce isolation *in the database*, so even a buggy repository query cannot
leak another tenant's rows.

Kept in the adapters package (not service-kit) so the DB adapter has no
dependency on the web stack.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_current_tenant: ContextVar[str | None] = ContextVar("zeus_current_tenant", default=None)


def get_bound_tenant() -> str | None:
    """The tenant bound to the current async context, if any."""
    return _current_tenant.get()


def bind_tenant(tenant_id: str | None) -> None:
    """Bind ``tenant_id`` for the current async context (request)."""
    _current_tenant.set(tenant_id)


@contextmanager
def tenant_scope(tenant_id: str | None) -> Iterator[None]:
    """Temporarily bind a tenant (used by background jobs and tests)."""
    token = _current_tenant.set(tenant_id)
    try:
        yield
    finally:
        _current_tenant.reset(token)
