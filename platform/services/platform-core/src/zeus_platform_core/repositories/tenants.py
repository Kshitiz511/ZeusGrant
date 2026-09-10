"""Tenants, users and memberships."""

from __future__ import annotations

import re

from zeus_adapters.interfaces import Database

from zeus_platform_core.domain.models import Role, Tenant

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.lower()).strip("-")
    return slug or "tenant"


class TenantRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def upsert_user(self, user_id: str, email: str, provider: str = "supabase") -> None:
        await self._db.execute(
            """
            INSERT INTO platform.users (id, email, auth_provider)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
            """,
            user_id,
            email,
            provider,
        )

    async def get_user_by_email(self, email: str) -> dict | None:
        return await self._db.fetch_one(
            "SELECT id, email FROM platform.users WHERE lower(email) = lower($1)", email
        )

    async def set_password_hash(self, user_id: str, password_hash: str) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.user_credentials (user_id, password_hash)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE
              SET password_hash = EXCLUDED.password_hash, updated_at = now()
            """,
            user_id,
            password_hash,
        )

    async def get_password_hash(self, user_id: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT password_hash FROM platform.user_credentials WHERE user_id = $1", user_id
        )
        return row["password_hash"] if row else None

    async def create_tenant(self, *, name: str, slug: str, owner_user_id: str) -> Tenant:
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.tenants (name, slug, owner_user_id)
            VALUES ($1, $2, $3)
            RETURNING id::text, name, slug, owner_user_id::text, status, stripe_customer_id
            """,
            name,
            slug,
            owner_user_id,
        )
        assert row is not None
        return Tenant(**row)

    async def add_membership(self, *, tenant_id: str, user_id: str, role: Role) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.memberships (tenant_id, user_id, role)
            VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role
            """,
            tenant_id,
            user_id,
            str(role),
        )

    async def get_by_slug(self, slug: str) -> Tenant | None:
        row = await self._db.fetch_one(
            """
            SELECT id::text, name, slug, owner_user_id::text, status, stripe_customer_id
            FROM platform.tenants WHERE slug = $1
            """,
            slug,
        )
        return Tenant(**row) if row else None

    async def get_by_id(self, tenant_id: str) -> Tenant | None:
        row = await self._db.fetch_one(
            """
            SELECT id::text, name, slug, owner_user_id::text, status, stripe_customer_id
            FROM platform.tenants WHERE id = $1
            """,
            tenant_id,
        )
        return Tenant(**row) if row else None

    async def get_membership_role(self, *, tenant_id: str, user_id: str) -> str | None:
        """The caller's role in a tenant, or None if they are not a member."""
        row = await self._db.fetch_one(
            """
            SELECT m.role
            FROM platform.memberships m
            JOIN platform.tenants t ON t.id = m.tenant_id
            WHERE m.tenant_id = $1 AND m.user_id = $2 AND t.status = 'active'
            """,
            tenant_id,
            user_id,
        )
        return row["role"] if row else None

    async def list_user_tenants(self, user_id: str) -> list[dict]:
        return await self._db.fetch(
            """
            SELECT t.id::text AS tenant_id, t.name, t.slug, m.role
            FROM platform.memberships m
            JOIN platform.tenants t ON t.id = m.tenant_id
            WHERE m.user_id = $1 AND t.status = 'active'
            ORDER BY t.created_at
            """,
            user_id,
        )

    async def set_stripe_customer(self, tenant_id: str, customer_id: str) -> None:
        await self._db.execute(
            "UPDATE platform.tenants SET stripe_customer_id = $2, updated_at = now() WHERE id = $1",
            tenant_id,
            customer_id,
        )
