"""Tenants, users and memberships."""

from __future__ import annotations

import re

from zeus_adapters.interfaces import Database

from zeus_platform_core.domain.models import ACCESS_GRANTING_STATUSES, Role, Tenant

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.lower()).strip("-")
    return slug or "tenant"


class TenantRepository:
    def __init__(self, db: Database) -> None:
        self._db = db

    async def upsert_user(
        self,
        user_id: str,
        email: str,
        provider: str = "supabase",
        full_name: str | None = None,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.users (id, email, auth_provider, full_name)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                email = EXCLUDED.email,
                -- COALESCE keeps an existing name when the caller does not
                -- supply one, so a later sign-in cannot blank out a name the
                -- user already set.
                full_name = COALESCE(EXCLUDED.full_name, platform.users.full_name)
            """,
            user_id,
            email,
            provider,
            full_name,
        )

    async def get_user_by_email(self, email: str) -> dict | None:
        return await self._db.fetch_one(
            "SELECT id, email, full_name, email_verified_at "
            "FROM platform.users WHERE lower(email) = lower($1)",
            email,
        )

    async def get_user_by_id(self, user_id: str) -> dict | None:
        return await self._db.fetch_one(
            "SELECT id, email, full_name, email_verified_at FROM platform.users WHERE id = $1",
            user_id,
        )

    async def is_platform_admin(self, user_id: str) -> bool:
        """Whether this account holds the platform-wide operator privilege.

        Read from the database on every token mint rather than carried forward
        from an existing token. The difference matters: a token is a snapshot
        taken when it was issued, so revoking the flag would otherwise leave
        the privilege live until the holder's token expired. Reading it here
        means a revocation takes effect on the next mint.

        Returns False for an unknown user rather than raising. The callers are
        token-mint paths that have already established identity; if the account
        has since vanished, "not an admin" is the safe answer and the mint
        fails for its own reasons further along.
        """
        row = await self._db.fetch_one(
            "SELECT is_platform_admin FROM platform.users WHERE id = $1",
            user_id,
        )
        return bool(row and row["is_platform_admin"])

    async def set_platform_admin(self, user_id: str, *, enabled: bool) -> bool:
        """Grant or revoke the platform privilege. Returns True if a row changed.

        Deliberately not exposed over HTTP. The only caller is
        ``scripts/grant_platform_admin.py``, which pairs it with an audit row.
        Making the first admin over an API would mean an endpoint that can
        create its own caller's privilege, which is a bootstrap hole; making it
        a deliberate act at the console with a record is the safer shape.
        """
        row = await self._db.fetch_one(
            """
            UPDATE platform.users SET is_platform_admin = $2
            WHERE id = $1 AND is_platform_admin IS DISTINCT FROM $2
            RETURNING id
            """,
            user_id,
            enabled,
        )
        return row is not None

    async def list_platform_admins(self) -> list[dict]:
        """Every account holding the privilege. Used by the bootstrap script to
        show who already has it before granting it to somebody else."""
        return await self._db.fetch(
            "SELECT id, email, full_name FROM platform.users "
            "WHERE is_platform_admin ORDER BY lower(email)"
        )

    async def mark_email_verified(self, user_id: str) -> None:
        # Idempotent by design: the WHERE clause keeps the original timestamp,
        # so re-verifying does not rewrite when it first happened.
        await self._db.execute(
            "UPDATE platform.users SET email_verified_at = now() "
            "WHERE id = $1 AND email_verified_at IS NULL",
            user_id,
        )

    # --- Federated identities ------------------------------------------------
    async def get_user_by_identity(self, provider: str, subject: str) -> dict | None:
        return await self._db.fetch_one(
            """
            SELECT u.id, u.email, u.full_name, u.email_verified_at
            FROM platform.user_identities i
            JOIN platform.users u ON u.id = i.user_id
            WHERE i.provider = $1 AND i.subject = $2
            """,
            provider,
            subject,
        )

    async def link_identity(
        self, *, user_id: str, provider: str, subject: str, email: str | None
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.user_identities (user_id, provider, subject, email, last_used_at)
            VALUES ($1, $2, $3, $4, now())
            ON CONFLICT (provider, subject)
            DO UPDATE SET last_used_at = now(), email = EXCLUDED.email
            """,
            user_id,
            provider,
            subject,
            email,
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

    async def clear_password_hash(self, user_id: str) -> None:
        """Revoke password sign-in for a user.

        Used when a verified Google identity claims an account that was created
        with an unverified email -- the password holder never proved they owned
        the address, so their credential is removed rather than left live
        alongside the rightful owner's.
        """
        await self._db.execute(
            "DELETE FROM platform.user_credentials WHERE user_id = $1", user_id
        )

    async def get_password_hash(self, user_id: str) -> str | None:
        row = await self._db.fetch_one(
            "SELECT password_hash FROM platform.user_credentials WHERE user_id = $1", user_id
        )
        return row["password_hash"] if row else None

    # --- email verification -------------------------------------------------

    async def create_email_verification(
        self, *, user_id: str, email: str, code_hash: str, ttl_minutes: int
    ) -> None:
        """Store a new verification code, superseding any earlier live one.

        Earlier codes are consumed rather than deleted so the audit trail of
        how many were requested survives. Superseding matters: if "resend" left
        the previous code working, the number of valid guesses would grow with
        every click and the attempt limit would mean nothing.
        """
        await self._db.execute(
            """
            UPDATE platform.email_verifications
               SET consumed_at = now()
             WHERE user_id = $1 AND consumed_at IS NULL
            """,
            user_id,
        )
        await self._db.execute(
            """
            INSERT INTO platform.email_verifications
                   (user_id, email, code_hash, expires_at)
            VALUES ($1, $2, $3, now() + make_interval(mins => $4))
            """,
            user_id,
            email,
            code_hash,
            ttl_minutes,
        )

    async def get_live_email_verification(self, user_id: str) -> dict | None:
        """Return the current unconsumed code row, expired or not.

        Expiry is judged by the caller so it can tell the user their code has
        expired. Filtering it out here would report "incorrect code" instead,
        which sends people hunting for a typo that does not exist.
        """
        row = await self._db.fetch_one(
            """
            SELECT id, code_hash, attempts, expires_at
              FROM platform.email_verifications
             WHERE user_id = $1 AND consumed_at IS NULL
             ORDER BY created_at DESC
             LIMIT 1
            """,
            user_id,
        )
        return dict(row) if row else None

    async def record_verification_attempt(self, verification_id: str) -> int:
        """Increment the attempt counter and return the new total.

        Returns the post-increment value from the database rather than adding
        one locally, so two concurrent guesses cannot both read the same count
        and each believe they were the last permitted attempt.
        """
        row = await self._db.fetch_one(
            """
            UPDATE platform.email_verifications
               SET attempts = attempts + 1
             WHERE id = $1
            RETURNING attempts
            """,
            verification_id,
        )
        return int(row["attempts"]) if row else 0

    async def consume_email_verification(self, verification_id: str) -> None:
        await self._db.execute(
            "UPDATE platform.email_verifications SET consumed_at = now() WHERE id = $1",
            verification_id,
        )

    async def count_recent_verifications(self, user_id: str, *, within_minutes: int) -> int:
        """How many codes this user has been sent recently.

        Each send costs money and lands in someone's inbox, so an unthrottled
        resend button is both a bill and a way to use the product to spam a
        third party's address.
        """
        row = await self._db.fetch_one(
            """
            SELECT count(*) AS n
              FROM platform.email_verifications
             WHERE user_id = $1
               AND created_at > now() - make_interval(mins => $2)
            """,
            user_id,
            within_minutes,
        )
        return int(row["n"]) if row else 0

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

    async def add_membership(
        self,
        *,
        tenant_id: str,
        user_id: str,
        role: Role,
        invited_by: str | None = None,
    ) -> None:
        await self._db.execute(
            """
            INSERT INTO platform.memberships (tenant_id, user_id, role, invited_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (tenant_id, user_id) DO UPDATE
              SET role = EXCLUDED.role, updated_at = now()
            """,
            tenant_id,
            user_id,
            str(role),
            invited_by,
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

    # -- platform-admin views -------------------------------------------------
    #
    # These are the only queries in this repository that deliberately cross
    # tenant boundaries. They are reachable exclusively from the platform-admin
    # router, which binds no tenant and so falls into the NULL branch of every
    # RLS policy. Nothing here may be called from a tenant-scoped request path.

    async def list_tenants(
        self,
        *,
        status: str | None = None,
        search: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """Every tenant on the platform, newest first, with a usage summary.

        ``search`` matches name, slug or owner email so an operator can find a
        tenant from whatever the customer quoted at them.

        The two counts are correlated subqueries rather than joins on purpose:
        joining memberships and subscriptions in one statement multiplies the
        rows together and would silently inflate both numbers.
        """
        return await self._db.fetch(
            """
            SELECT t.id::text                AS id,
                   t.name,
                   t.slug,
                   t.status,
                   t.created_at,
                   t.stripe_customer_id,
                   u.email                   AS owner_email,
                   (SELECT count(*) FROM platform.memberships m
                     WHERE m.tenant_id = t.id)                      AS member_count,
                   (SELECT count(*) FROM platform.subscriptions s
                     WHERE s.tenant_id = t.id
                       AND s.status = ANY($5::text[]))              AS active_module_count,
                   (SELECT count(*) FROM platform.tenant_limit_overrides o
                     WHERE o.tenant_id = t.id)                      AS override_count
            FROM platform.tenants t
            LEFT JOIN platform.users u ON u.id = t.owner_user_id
            WHERE ($1::text IS NULL OR t.status = $1)
              AND (
                    $2::text IS NULL
                 OR t.name  ILIKE '%' || $2 || '%'
                 OR t.slug  ILIKE '%' || $2 || '%'
                 OR u.email ILIKE '%' || $2 || '%'
              )
            ORDER BY t.created_at DESC
            LIMIT $3 OFFSET $4
            """,
            status,
            search,
            max(1, min(limit, 200)),
            max(0, offset),
            sorted(str(s) for s in ACCESS_GRANTING_STATUSES),
        )

    async def count_tenants(self, *, status: str | None = None, search: str | None = None) -> int:
        """Total matching ``list_tenants``, so the UI can page without guessing."""
        row = await self._db.fetch_one(
            """
            SELECT count(*) AS n
            FROM platform.tenants t
            LEFT JOIN platform.users u ON u.id = t.owner_user_id
            WHERE ($1::text IS NULL OR t.status = $1)
              AND (
                    $2::text IS NULL
                 OR t.name  ILIKE '%' || $2 || '%'
                 OR t.slug  ILIKE '%' || $2 || '%'
                 OR u.email ILIKE '%' || $2 || '%'
              )
            """,
            status,
            search,
        )
        return int(row["n"]) if row else 0

    async def set_status(self, tenant_id: str, status: str) -> dict | None:
        """Change a tenant's status, returning both the old and new values.

        The previous value is returned from the same statement that writes the
        new one so the audit record cannot disagree with what actually happened.
        Reading it in a separate query would leave a window in which a
        concurrent change makes the audit trail a lie.

        Returns None if no such tenant exists, which the caller must translate
        into a 404 rather than reporting a successful no-op.
        """
        row = await self._db.fetch_one(
            """
            UPDATE platform.tenants t
               SET status = $2, updated_at = now()
              FROM (SELECT id, status FROM platform.tenants WHERE id = $1 FOR UPDATE) prev
             WHERE t.id = prev.id
            RETURNING prev.status AS previous_status, t.status AS status
            """,
            tenant_id,
            status,
        )
        return dict(row) if row else None

    # -- per-tenant limit overrides -------------------------------------------

    async def list_limit_overrides(self, tenant_id: str) -> list[dict]:
        return await self._db.fetch(
            """
            SELECT o.limit_key,
                   o.limit_value,
                   o.reason,
                   o.set_by::text AS set_by,
                   u.email        AS set_by_email,
                   o.created_at,
                   o.updated_at
            FROM platform.tenant_limit_overrides o
            LEFT JOIN platform.users u ON u.id = o.set_by
            WHERE o.tenant_id = $1
            ORDER BY o.limit_key
            """,
            tenant_id,
        )

    async def limit_overrides_map(self, tenant_id: str) -> dict[str, int | None]:
        """Overrides shaped for the entitlement resolver.

        A key present with a NULL value means explicitly unlimited, which is why
        this returns ``dict[str, int | None]`` rather than dropping the NULLs.
        Dropping them would turn "uncapped" back into "use the plan's cap".
        """
        rows = await self._db.fetch(
            """
            SELECT limit_key, limit_value
            FROM platform.tenant_limit_overrides
            WHERE tenant_id = $1
            """,
            tenant_id,
        )
        return {row["limit_key"]: row["limit_value"] for row in rows}

    async def set_limit_override(
        self,
        *,
        tenant_id: str,
        limit_key: str,
        limit_value: int | None,
        reason: str,
        set_by: str | None,
    ) -> dict | None:
        """Upsert one override, returning the previous value if there was one.

        ``previous_value`` and ``existed`` are returned separately because a
        previous value of NULL is meaningful (explicitly unlimited) and cannot
        be distinguished from "there was no override" by the value alone.
        """
        before = await self._db.fetch_one(
            """
            SELECT limit_value, reason
            FROM platform.tenant_limit_overrides
            WHERE tenant_id = $1 AND limit_key = $2
            """,
            tenant_id,
            limit_key,
        )
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.tenant_limit_overrides
                   (tenant_id, limit_key, limit_value, reason, set_by)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (tenant_id, limit_key) DO UPDATE
               SET limit_value = EXCLUDED.limit_value,
                   reason      = EXCLUDED.reason,
                   set_by      = EXCLUDED.set_by,
                   updated_at  = now()
            RETURNING limit_key, limit_value, reason, created_at, updated_at
            """,
            tenant_id,
            limit_key,
            limit_value,
            reason,
            set_by,
        )
        if row is None:
            return None
        return {
            **dict(row),
            "existed": before is not None,
            "previous_value": before["limit_value"] if before else None,
            "previous_reason": before["reason"] if before else None,
        }

    async def clear_limit_override(self, *, tenant_id: str, limit_key: str) -> dict | None:
        """Remove an override so the limit falls back to the plan.

        Returns the deleted row, or None if there was nothing to delete — the
        caller should 404 rather than claim to have removed something.
        """
        row = await self._db.fetch_one(
            """
            DELETE FROM platform.tenant_limit_overrides
            WHERE tenant_id = $1 AND limit_key = $2
            RETURNING limit_key, limit_value, reason
            """,
            tenant_id,
            limit_key,
        )
        return dict(row) if row else None

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

    # --- members -------------------------------------------------------------

    async def list_members(self, tenant_id: str) -> list[dict]:
        """Everyone in a workspace, owner first.

        Ordered by role rather than by name so the person answerable for the
        account is at the top of the list, which is what an admin looking at
        this screen is usually trying to find.
        """
        return await self._db.fetch(
            """
            SELECT u.id::text   AS user_id,
                   u.email,
                   u.full_name,
                   m.role,
                   m.created_at,
                   m.invited_by::text AS invited_by
              FROM platform.memberships m
              JOIN platform.users u ON u.id = m.user_id
             WHERE m.tenant_id = $1
             ORDER BY CASE m.role
                        WHEN 'owner'  THEN 0
                        WHEN 'admin'  THEN 1
                        WHEN 'member' THEN 2
                        ELSE 3
                      END,
                      m.created_at
            """,
            tenant_id,
        )

    async def count_members(self, tenant_id: str) -> int:
        row = await self._db.fetch_one(
            "SELECT count(*) AS n FROM platform.memberships WHERE tenant_id = $1",
            tenant_id,
        )
        return int(row["n"]) if row else 0

    async def update_member_role(self, *, tenant_id: str, user_id: str, role: Role) -> bool:
        """Change a role. Returns False when there is no such membership.

        Deliberately refuses to write 'owner'. The one-owner index would reject
        a second one anyway, but failing here gives a clear error instead of a
        unique-violation surfacing as a 500. Ownership moves through
        ``transfer_ownership``.
        """
        if role is Role.owner:
            raise ValueError("Use transfer_ownership to move ownership.")
        row = await self._db.fetch_one(
            """
            UPDATE platform.memberships
               SET role = $3, updated_at = now()
             WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner'
            RETURNING user_id::text
            """,
            tenant_id,
            user_id,
            str(role),
        )
        return row is not None

    async def remove_member(self, *, tenant_id: str, user_id: str) -> bool:
        """Remove a member. The owner is excluded by the WHERE clause.

        Returns False both when the membership does not exist and when it is
        the owner's, so the caller cannot use the result to distinguish the two
        -- neither is a permitted outcome and both are the same refusal.
        """
        row = await self._db.fetch_one(
            """
            DELETE FROM platform.memberships
             WHERE tenant_id = $1 AND user_id = $2 AND role <> 'owner'
            RETURNING user_id::text
            """,
            tenant_id,
            user_id,
        )
        return row is not None

    async def transfer_ownership(
        self, *, tenant_id: str, from_user_id: str, to_user_id: str
    ) -> None:
        """Move ownership between two existing members.

        The demotion and the promotion are two statements against a table with
        a unique index permitting one owner, so the order matters: demote
        first, or the promotion violates the index. Both run inside the
        caller's transaction.
        """
        await self._db.execute(
            """
            UPDATE platform.memberships
               SET role = 'admin', updated_at = now()
             WHERE tenant_id = $1 AND user_id = $2 AND role = 'owner'
            """,
            tenant_id,
            from_user_id,
        )
        await self._db.execute(
            """
            UPDATE platform.memberships
               SET role = 'owner', updated_at = now()
             WHERE tenant_id = $1 AND user_id = $2
            """,
            tenant_id,
            to_user_id,
        )
        await self._db.execute(
            "UPDATE platform.tenants SET owner_user_id = $2, updated_at = now() WHERE id = $1",
            tenant_id,
            to_user_id,
        )

    # --- invites -------------------------------------------------------------

    async def create_invite(
        self,
        *,
        tenant_id: str,
        email: str,
        role: Role,
        token_hash: str,
        invited_by: str,
        ttl_hours: int,
    ) -> dict:
        row = await self._db.fetch_one(
            """
            INSERT INTO platform.invites
                   (tenant_id, email, role, token_hash, invited_by, expires_at)
            VALUES ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
            RETURNING id::text, tenant_id::text, email, role, expires_at, created_at
            """,
            tenant_id,
            email,
            str(role),
            token_hash,
            invited_by,
            ttl_hours,
        )
        assert row is not None
        return dict(row)

    async def get_invite_by_hash(self, token_hash: str) -> dict | None:
        """Look an invite up by its hashed token.

        Expiry is not filtered here. The caller judges it so it can say "this
        invite has expired" rather than "no such invite", which is the
        difference between a user asking for a fresh one and a user assuming
        the link was fake.
        """
        row = await self._db.fetch_one(
            """
            SELECT i.id::text, i.tenant_id::text AS tenant_id, i.email, i.role,
                   i.expires_at, i.accepted_at, i.revoked_at,
                   t.name AS tenant_name
              FROM platform.invites i
              JOIN platform.tenants t ON t.id = i.tenant_id
             WHERE i.token_hash = $1
            """,
            token_hash,
        )
        return dict(row) if row else None

    async def list_invites(self, tenant_id: str) -> list[dict]:
        """Invites still outstanding. Accepted and revoked rows are kept in the
        table for the audit trail but are not pending, so they are not shown."""
        return await self._db.fetch(
            """
            SELECT i.id::text, i.email, i.role, i.expires_at, i.created_at,
                   u.email AS invited_by_email
              FROM platform.invites i
         LEFT JOIN platform.users u ON u.id = i.invited_by
             WHERE i.tenant_id = $1
               AND i.accepted_at IS NULL
               AND i.revoked_at IS NULL
             ORDER BY i.created_at DESC
            """,
            tenant_id,
        )

    async def revoke_invite(self, *, tenant_id: str, invite_id: str) -> bool:
        row = await self._db.fetch_one(
            """
            UPDATE platform.invites
               SET revoked_at = now()
             WHERE id = $1 AND tenant_id = $2
               AND accepted_at IS NULL AND revoked_at IS NULL
            RETURNING id::text
            """,
            invite_id,
            tenant_id,
        )
        return row is not None

    async def mark_invite_accepted(self, *, invite_id: str, user_id: str) -> bool:
        """Consume an invite.

        The WHERE clause re-checks unaccepted, unrevoked and unexpired rather
        than trusting the caller's earlier read. Two people clicking the same
        link at once both pass that read; only one of them updates a row here,
        and the loser is told the invite is no longer valid.
        """
        row = await self._db.fetch_one(
            """
            UPDATE platform.invites
               SET accepted_at = now(), accepted_by = $2
             WHERE id = $1
               AND accepted_at IS NULL
               AND revoked_at IS NULL
               AND expires_at > now()
            RETURNING id::text
            """,
            invite_id,
            user_id,
        )
        return row is not None

    async def set_stripe_customer(self, tenant_id: str, customer_id: str) -> None:
        await self._db.execute(
            "UPDATE platform.tenants SET stripe_customer_id = $2, updated_at = now() WHERE id = $1",
            tenant_id,
            customer_id,
        )
