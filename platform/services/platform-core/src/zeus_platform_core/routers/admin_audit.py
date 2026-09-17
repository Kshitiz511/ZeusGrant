"""Shared audit helper for every platform-admin router.

This lives in its own module because the admin surface is split across several
routers (settings and prompts, tenants, plans, models) and all of them must
write the same shaped audit row. A helper copied into each router would drift:
one of them would forget the forwarded-header fallback, or record the session
email without the database fallback, and the trail would be inconsistent in
exactly the cases it exists to explain.

The audit write is deliberately **not** wrapped in try/except. If it fails, the
admin action fails with it. A system that appears audited and silently is not is
worse than one that is visibly not.
"""

from __future__ import annotations

from fastapi import Request
from zeus_adapters.models import Session

from zeus_platform_core.container import Container


async def audit_action(
    container: Container,
    request: Request,
    admin: Session,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    before: dict | None = None,
    after: dict | None = None,
) -> None:
    """Record one admin action, with the caller's identity and origin.

    The IP is read from the proxy's forwarded header before falling back to the
    socket peer, because in production every request arrives from Vercel's edge
    and the peer address would otherwise be identical on every row -- a field
    that never varies is worse than no field, since it looks meaningful.

    The email is read from the database rather than taken from the session.
    First-party tokens carry only a subject and roles, so ``session.email`` is
    None for them, and a trail that records the actor as ``null`` fails at the
    one question it exists to answer. It matters most in the case the schema
    was designed for: ``actor_user_id`` is set to NULL if the account is later
    deleted, and the flat email is then all that identifies the row. One extra
    query on an admin mutation is not a cost worth optimising.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else None)

    email = admin.email
    if not email:
        user = await container.tenants.get_user_by_id(admin.user_id)
        email = str(user["email"]) if user else None

    await container.audit.record(
        action=action,
        actor_user_id=admin.user_id,
        actor_email=email,
        target_type=target_type,
        target_id=target_id,
        before=before,
        after=after,
        ip=ip,
        user_agent=request.headers.get("user-agent"),
    )
