"""Tenancy service — provisioning and membership.

When someone signs up (or first authenticates), we ensure a local user record
exists and, if they have no tenant yet, provision one with them as owner.
"""

from __future__ import annotations

from zeus_platform_core.domain.models import Role, Tenant
from zeus_platform_core.repositories.tenants import TenantRepository, slugify


class TenancyService:
    def __init__(self, tenants: TenantRepository) -> None:
        self._tenants = tenants

    async def _unique_slug(self, base: str) -> str:
        slug = slugify(base)
        candidate = slug
        suffix = 2
        while await self._tenants.get_by_slug(candidate) is not None:
            candidate = f"{slug}-{suffix}"
            suffix += 1
        return candidate

    async def provision_tenant(
        self, *, user_id: str, email: str, tenant_name: str | None = None
    ) -> Tenant:
        """Create a tenant owned by the user. Idempotent on the user record."""
        await self._tenants.upsert_user(user_id, email)
        name = tenant_name or (email.split("@")[0] if email else "My workspace")
        slug = await self._unique_slug(name)
        tenant = await self._tenants.create_tenant(
            name=name, slug=slug, owner_user_id=user_id
        )
        await self._tenants.add_membership(
            tenant_id=tenant.id, user_id=user_id, role=Role.owner
        )
        return tenant

    async def ensure_tenant(self, *, user_id: str, email: str) -> Tenant:
        """Return the user's first tenant, provisioning one if none exists."""
        await self._tenants.upsert_user(user_id, email)
        existing = await self._tenants.list_user_tenants(user_id)
        if existing:
            first = existing[0]
            tenant = await self._tenants.get_by_id(first["tenant_id"])
            if tenant is not None:
                return tenant
        return await self.provision_tenant(user_id=user_id, email=email)
