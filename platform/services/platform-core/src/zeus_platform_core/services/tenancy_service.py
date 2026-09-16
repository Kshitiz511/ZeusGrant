"""Tenancy service — provisioning, membership and invites.

When someone signs up (or first authenticates), we ensure a local user record
exists and, if they have no tenant yet, provision one with them as owner.

Everything below the provisioning methods exists so a workspace can have more
than one person in it. Three rules shape that code and are worth stating once
rather than repeating at each call site:

* **A workspace always has exactly one owner.** The database enforces it with
  a partial unique index, so the service never has to reason about a tenant
  that has drifted into having none or two. Ownership moves by transfer, which
  demotes and promotes together.
* **A seat is consumed by a member or by a live invite.** Counting only
  members would let an admin issue fifty invites against a three-seat plan and
  discover the problem when the fourth person tried to join, which is the
  worst possible moment to find out.
* **Authorisation is cached, so removal has to evict.** ``service-kit`` caches
  membership for sixty seconds. Deleting a row without deleting the key leaves
  somebody with access to a workspace they were just removed from, which is
  exactly the situation an admin pressing "remove" is trying to end.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import UTC, datetime

from zeus_adapters.interfaces import Cache, EmailSender

from zeus_platform_core.domain.models import Role, Tenant
from zeus_platform_core.repositories.tenants import TenantRepository, slugify

log = logging.getLogger(__name__)

#: How long an invite link stays usable. Long enough to survive a weekend and
#: a forwarded mail, short enough that a link leaked from an inbox much later
#: is worthless.
INVITE_TTL_HOURS = 7 * 24

#: Roles an invite may carry. Ownership is transferred between people who have
#: already joined, never granted to someone who has not accepted yet.
INVITABLE_ROLES: frozenset[Role] = frozenset({Role.admin, Role.member, Role.viewer})

#: The plan limit governing how many people may be in a workspace. Seeded for
#: eight plans since 0002 and, until this module existed, read by nothing.
SEAT_LIMIT_KEY = "team_seats"

#: Mirrors ``_MEMBER_PREFIX`` in zeus_service_kit.security. Duplicated rather
#: than imported because platform-core does not otherwise reach into the kit's
#: internals; a wrong value here fails loudly in the removal test.
_MEMBER_CACHE_PREFIX = "membership:"


class TenancyError(Exception):
    """A membership operation that failed for a reason worth showing a user."""


class SeatLimitReached(TenancyError):
    """The plan's seat allowance is exhausted.

    Surfaced as 402 rather than 403: the caller is permitted to do this, they
    simply need a larger plan.
    """


def hash_invite_token(token: str) -> str:
    """Hash an invite token for storage.

    SHA-256 with no work factor is right here, unlike a password: the token is
    32 bytes of ``secrets`` output, so there is nothing to brute force. The
    hash exists so that read access to the table does not hand out working
    invitations.
    """
    return hashlib.sha256(token.encode()).hexdigest()


class TenancyService:
    def __init__(
        self,
        tenants: TenantRepository,
        *,
        cache: Cache | None = None,
        email: EmailSender | None = None,
        entitlements: object | None = None,
        app_base_url: str = "",
    ) -> None:
        self._tenants = tenants
        self._cache = cache
        self._email = email
        self._entitlements = entitlements
        self._base_url = app_base_url.rstrip("/")

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

    # --- seats ---------------------------------------------------------------

    async def seat_usage(self, tenant_id: str) -> dict:
        """Seats used and allowed.

        ``limit`` of ``None`` means unlimited, the convention used throughout
        ``plan_limits``. A missing row is unlimited rather than zero, which
        matters because the opposite default would lock every existing
        workspace out of inviting anyone the moment this shipped.

        The allowance is the largest seat count across the modules a tenant
        subscribes to, not the sum. Seats are people in a workspace, and a
        person who can see two modules is still one person.
        """
        used = await self._tenants.count_members(tenant_id)
        pending = len(await self._tenants.list_invites(tenant_id))

        limit: int | None = None
        if self._entitlements is not None:
            try:
                claims = await self._entitlements.get_claims(tenant_id)
            except Exception:  # noqa: BLE001 - never block a seat check on the cache
                log.warning("seats.claims_unavailable tenant=%s", tenant_id, exc_info=True)
            else:
                seats = [
                    ent.limits.get(SEAT_LIMIT_KEY)
                    for ent in claims.modules.values()
                    if ent.is_active
                ]
                # An unlimited module makes the workspace unlimited, so a None
                # anywhere in the list wins over any number.
                if seats and all(s is not None for s in seats):
                    limit = max(int(s) for s in seats)  # type: ignore[arg-type]

        return {
            "used": used,
            "pending": pending,
            "limit": limit,
            "remaining": None if limit is None else max(0, limit - used - pending),
        }

    # --- members -------------------------------------------------------------

    async def list_members(self, tenant_id: str) -> list[dict]:
        return await self._tenants.list_members(tenant_id)

    async def change_role(self, *, tenant_id: str, user_id: str, role: Role) -> None:
        if role not in INVITABLE_ROLES:
            raise TenancyError(
                "Ownership is moved by transferring it, not by setting a role."
            )
        changed = await self._tenants.update_member_role(
            tenant_id=tenant_id, user_id=user_id, role=role
        )
        if not changed:
            # Covers both "not a member" and "is the owner". The caller gets
            # one refusal either way; separating them would tell an admin
            # something they cannot act on.
            raise TenancyError("That person is not a member, or is the workspace owner.")
        await self._evict_membership(user_id=user_id, tenant_id=tenant_id)

    async def remove_member(self, *, tenant_id: str, user_id: str) -> None:
        removed = await self._tenants.remove_member(tenant_id=tenant_id, user_id=user_id)
        if not removed:
            raise TenancyError(
                "That person is not a member, or is the workspace owner. "
                "Transfer ownership before removing the owner."
            )
        await self._evict_membership(user_id=user_id, tenant_id=tenant_id)

    async def transfer_ownership(
        self, *, tenant_id: str, from_user_id: str, to_user_id: str
    ) -> None:
        if from_user_id == to_user_id:
            raise TenancyError("That person is already the owner.")
        target_role = await self._tenants.get_membership_role(
            tenant_id=tenant_id, user_id=to_user_id
        )
        if target_role is None:
            raise TenancyError("Ownership can only be given to an existing member.")
        await self._tenants.transfer_ownership(
            tenant_id=tenant_id, from_user_id=from_user_id, to_user_id=to_user_id
        )
        await self._evict_membership(user_id=from_user_id, tenant_id=tenant_id)
        await self._evict_membership(user_id=to_user_id, tenant_id=tenant_id)

    # --- invites -------------------------------------------------------------

    async def list_invites(self, tenant_id: str) -> list[dict]:
        return await self._tenants.list_invites(tenant_id)

    async def invite_member(
        self,
        *,
        tenant_id: str,
        tenant_name: str,
        email: str,
        role: Role,
        invited_by: str,
    ) -> dict:
        """Create an invite and try to deliver it.

        Returns the invite along with its accept URL. The URL goes back to the
        caller on purpose, and is shown in the UI: email delivery is the part
        of this flow most likely to fail for reasons nobody in the product can
        fix, and an admin who can copy a link is not blocked by a bounced
        message or a provider outage.
        """
        email = email.strip().lower()
        if not email or "@" not in email:
            raise TenancyError("That does not look like an email address.")
        if role not in INVITABLE_ROLES:
            raise TenancyError(f"{role} is not a role that can be invited.")

        existing_user = await self._tenants.get_user_by_email(email)
        if existing_user is not None:
            current = await self._tenants.get_membership_role(
                tenant_id=tenant_id, user_id=str(existing_user["id"])
            )
            if current is not None:
                raise TenancyError("That person is already in this workspace.")

        seats = await self.seat_usage(tenant_id)
        if seats["remaining"] is not None and seats["remaining"] <= 0:
            raise SeatLimitReached(
                f"This plan includes {seats['limit']} seat(s), and they are all "
                f"taken ({seats['used']} member(s), {seats['pending']} pending "
                "invite(s)). Upgrade the plan or revoke a pending invite."
            )

        # 32 bytes, URL-safe. The plaintext exists only in this function and in
        # the link handed back; the database stores only the hash.
        token = secrets.token_urlsafe(32)
        try:
            invite = await self._tenants.create_invite(
                tenant_id=tenant_id,
                email=email,
                role=role,
                token_hash=hash_invite_token(token),
                invited_by=invited_by,
                ttl_hours=INVITE_TTL_HOURS,
            )
        except Exception as exc:  # noqa: BLE001 - the unique index is the real check
            raise TenancyError(
                "There is already a pending invite for that address."
            ) from exc

        accept_url = f"{self._base_url}/invite?token={token}" if self._base_url else ""
        invite["accept_url"] = accept_url
        invite["email_sent"] = await self._send_invite_email(
            email=email, tenant_name=tenant_name, accept_url=accept_url
        )
        return invite

    async def revoke_invite(self, *, tenant_id: str, invite_id: str) -> None:
        if not await self._tenants.revoke_invite(tenant_id=tenant_id, invite_id=invite_id):
            raise TenancyError("That invite has already been used or revoked.")

    async def accept_invite(self, *, token: str, user_id: str, user_email: str) -> dict:
        """Join the workspace an invite names.

        The invite is matched to the signed-in account by email. Binding on the
        token alone would make the link a transferable credential: anyone who
        saw a forwarded message could join a workspace they were never offered,
        under their own account, and the audit trail would show them as a
        legitimately invited member.
        """
        invite = await self._tenants.get_invite_by_hash(hash_invite_token(token))
        if invite is None:
            raise TenancyError("That invite link is not valid.")
        if invite["revoked_at"] is not None:
            raise TenancyError("That invite has been revoked.")
        if invite["accepted_at"] is not None:
            raise TenancyError("That invite has already been used.")
        if invite["expires_at"] <= datetime.now(UTC):
            raise TenancyError("That invite has expired. Ask for a new one.")

        if invite["email"].strip().lower() != (user_email or "").strip().lower():
            # Deliberately vague. Naming the invited address would turn a
            # leaked link into a way to learn who was invited.
            raise TenancyError(
                "This invite was sent to a different email address. "
                "Sign in with the address it was sent to."
            )

        # Re-checks the same conditions inside the UPDATE, so two people
        # clicking at once cannot both win.
        if not await self._tenants.mark_invite_accepted(
            invite_id=invite["id"], user_id=user_id
        ):
            raise TenancyError("That invite is no longer valid.")

        await self._tenants.add_membership(
            tenant_id=invite["tenant_id"],
            user_id=user_id,
            role=Role(invite["role"]),
        )
        # A negative membership answer may already be cached from an attempt
        # seconds ago; without this the new member is refused for up to a
        # minute after joining.
        await self._evict_membership(user_id=user_id, tenant_id=invite["tenant_id"])
        return {
            "tenant_id": invite["tenant_id"],
            "tenant_name": invite["tenant_name"],
            "role": invite["role"],
        }

    # --- internals -----------------------------------------------------------

    async def _evict_membership(self, *, user_id: str, tenant_id: str) -> None:
        if self._cache is None:
            return
        try:
            await self._cache.delete(f"{_MEMBER_CACHE_PREFIX}{user_id}:{tenant_id}")
        except Exception:  # noqa: BLE001
            # The key expires on its own within a minute, so a cache outage
            # delays the change rather than losing it. Failing the request
            # would undo a membership change that is already committed.
            log.warning(
                "membership.cache_evict_failed user=%s tenant=%s",
                user_id,
                tenant_id,
                exc_info=True,
            )

    async def _send_invite_email(
        self, *, email: str, tenant_name: str, accept_url: str
    ) -> bool:
        if self._email is None or not accept_url:
            return False
        try:
            await self._email.send(
                to=email,
                subject=f"You have been invited to {tenant_name} on Zeus",
                text=(
                    f"You have been invited to join {tenant_name} on Zeus.\n\n"
                    f"Accept the invitation:\n{accept_url}\n\n"
                    f"The link expires in {INVITE_TTL_HOURS // 24} days. "
                    "If you were not expecting this, you can ignore it."
                ),
            )
            return True
        except Exception:  # noqa: BLE001
            # The invite is already committed and the link already works, so a
            # send failure costs convenience, not correctness. The caller shows
            # the link instead.
            log.warning("invite.email_failed to=%s", email, exc_info=True)
            return False
