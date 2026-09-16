-- 0016: platform admin identity, and an append-only record of what admins do.
--
-- Closes D5: `require_platform_admin` has been enforced since the admin router
-- was written, but nothing in the system ever grants the role. The only code
-- path that can put `platform_admin` into a token is the dev router, which
-- refuses to run outside development. So today the admin API is unreachable in
-- production by anyone, including the person who owns the platform. This adds
-- the missing half: a durable flag on the user, read at token-mint time.
--
-- ---------------------------------------------------------------------------
-- 1. WHY A COLUMN AND NOT A ROLES TABLE
-- ---------------------------------------------------------------------------
-- A general role system (roles, permissions, grants) is the obvious design and
-- the wrong one to build now. There is exactly one platform-wide privilege and
-- no evidence yet of a second. A boolean that is trivially auditable beats a
-- permission framework whose first real use is a single row. When a second
-- privilege appears with a real use case, that is the moment to generalise --
-- and migrating one boolean into a table is a small, obvious change.
--
-- ---------------------------------------------------------------------------
-- 2. WHY THE AUDIT TABLE HAS NO tenant_id
-- ---------------------------------------------------------------------------
-- Admin actions are platform-wide: editing a model price or rotating a
-- provider key belongs to no tenant. Giving the table a tenant_id would invite
-- it into the RLS loop in 0013, where an unbound connection would see
-- everything and a bound one would see nothing -- neither being the answer.
-- It is deliberately outside RLS, and 0013's table list is explicit rather
-- than discovered, so this table will not be swept in by accident.
--
-- ---------------------------------------------------------------------------
-- 3. WHY APPEND-ONLY IS ENFORCED BY THE DATABASE
-- ---------------------------------------------------------------------------
-- An audit log the application can rewrite is a log of what the application
-- last decided to say, not of what happened. The privileges below are the
-- control: zeus_app may INSERT and SELECT, and is explicitly denied UPDATE and
-- DELETE. The REVOKE is not redundant with "never granted" -- provision_db_role
-- sets ALTER DEFAULT PRIVILEGES granting UPDATE and DELETE on future tables in
-- this schema, so a new table arrives writable unless this says otherwise.
-- Without the REVOKE the table would be silently editable.

-- ---------------------------------------------------------------------------
-- The flag
-- ---------------------------------------------------------------------------

ALTER TABLE platform.users
    ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN platform.users.is_platform_admin IS
    'Platform-wide operator privilege. Read at token-mint time, never carried '
    'forward from an existing token. Granted only by scripts/grant_platform_admin.py, '
    'which records the grant in platform.admin_audit.';

-- Partial, because the expected cardinality is a handful of rows out of every
-- user on the platform. Indexing only the true rows keeps it small and makes
-- "who are the admins" a cheap question to ask.
CREATE INDEX IF NOT EXISTS users_platform_admin_idx
    ON platform.users (id)
    WHERE is_platform_admin;

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform.admin_audit (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Nullable, and ON DELETE SET NULL below, for one reason: the record of an
    -- action must outlive the account that performed it. A cascade here would
    -- let someone erase their own history by deleting their user, which is
    -- precisely the case an audit log exists to cover. actor_email is stored
    -- alongside as a flat string so the row stays readable afterwards.
    actor_user_id  uuid REFERENCES platform.users(id) ON DELETE SET NULL,
    actor_email    text,

    action         text NOT NULL,
    target_type    text,
    target_id      text,

    -- before/after are jsonb rather than a diff string so the change can be
    -- inspected later without parsing prose. Secret values are NEVER recorded:
    -- the helper writes {"changed": true} instead. An audit log that captures
    -- the API key it was auditing is a second place to leak it from.
    before         jsonb,
    after          jsonb,

    ip             inet,
    user_agent     text,

    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform.admin_audit IS
    'Append-only record of platform-admin actions. zeus_app may INSERT and '
    'SELECT only; UPDATE and DELETE are revoked so the application cannot '
    'rewrite its own history. Intentionally outside RLS: admin actions are '
    'platform-wide and belong to no tenant.';

COMMENT ON COLUMN platform.admin_audit.before IS
    'Prior state, or {"changed": true} where the value is a secret. Never the secret itself.';

-- The read pattern is "most recent first", optionally narrowed to one actor or
-- one target. Two indexes rather than one wide one, because those are two
-- different questions and neither is a prefix of the other.
CREATE INDEX IF NOT EXISTS admin_audit_created_idx
    ON platform.admin_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_target_idx
    ON platform.admin_audit (target_type, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT ON platform.admin_audit TO zeus_app;

-- Deliberate and load-bearing: see note 3 above. Default privileges would
-- otherwise have made this table mutable by the application.
REVOKE UPDATE, DELETE ON platform.admin_audit FROM zeus_app;
