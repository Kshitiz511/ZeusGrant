-- ---------------------------------------------------------------------------
-- 0014: real tenant roles, member management and invites.
--
-- Three things ship together here because they are one feature: a workspace
-- owner needs to bring colleagues in, give them a role, and take it away.
--
-- ---------------------------------------------------------------------------
-- Why the seat limits arrive in the same migration
-- ---------------------------------------------------------------------------
-- platform.plan_limits has carried a `team_seats` row for eight plans since
-- 0002, and nothing has ever read it. Invites are the first code that can
-- enforce it, so the limit stops being decorative in the same change that
-- makes it meaningful. Nothing else is needed for seats -- the rows exist.
--
-- ---------------------------------------------------------------------------
-- Why the grant limit keys are corrected here
-- ---------------------------------------------------------------------------
-- grant_service reads two limit keys, `scans_per_month` and `matches_visible`.
-- Neither has ever been seeded, so every lookup missed and the service fell
-- back to its hardcoded defaults (3 and 25). Separately the service asked for
-- them under module id 'grant-intelligence' with a hyphen, while the database
-- and the entitlement claims use 'grant_intelligence' with an underscore, so
-- the lookup could not have matched even had the rows existed.
--
-- The application fix for the module id lands in the same commit. That turns a
-- lookup that always missed into one that always hits, which means these rows
-- decide behaviour from the moment the code deploys. They are therefore seeded
-- to values that preserve what tenants experience today:
--
--   * matches_visible mirrors the matches_per_month row already seeded for
--     each plan, so the number of matches a plan shows does not move.
--   * scans_per_month keeps the starter tier at the current fallback of 3 and
--     scales with the tier above it.
--
-- Enterprise plans are deliberately left with no rows at all. A missing row
-- means unlimited throughout this schema, which is what an enterprise
-- agreement is for.
-- ---------------------------------------------------------------------------

-- --- memberships: provenance and a single owner ----------------------------

ALTER TABLE platform.memberships
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS invited_by uuid REFERENCES platform.users(id);

-- One owner per tenant, enforced by the database rather than by every code
-- path that writes a role remembering to check. Ownership transfer therefore
-- has to demote the outgoing owner and promote the incoming one inside one
-- transaction, which is the correct shape for that operation anyway.
CREATE UNIQUE INDEX IF NOT EXISTS memberships_one_owner_idx
    ON platform.memberships (tenant_id)
    WHERE role = 'owner';

-- --- invites ---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform.invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    email       text NOT NULL,
    role        text NOT NULL DEFAULT 'member',
    -- Hashed, never stored in the clear. An invite token is a bearer
    -- credential: anyone holding it can join the workspace, so a database
    -- read must not be enough to mint one. Same discipline as the email
    -- verification codes in 0007.
    token_hash  text NOT NULL,
    invited_by  uuid REFERENCES platform.users(id),
    expires_at  timestamptz NOT NULL,
    accepted_at timestamptz,
    accepted_by uuid REFERENCES platform.users(id),
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invites_role_known CHECK (role IN ('admin', 'member', 'viewer')),
    -- 'owner' is absent on purpose: ownership is transferred between existing
    -- members, never handed to someone who has not joined yet.
    CONSTRAINT invites_not_both_resolved CHECK (
        accepted_at IS NULL OR revoked_at IS NULL
    )
);

-- One live invite per address per workspace. Partial, so a revoked or
-- accepted invite frees the address to be invited again -- which is what
-- happens when somebody leaves and later returns.
CREATE UNIQUE INDEX IF NOT EXISTS invites_live_email_idx
    ON platform.invites (tenant_id, lower(email))
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Acceptance looks the invite up by hash and nothing else, so this index is
-- the whole read path for that request.
CREATE UNIQUE INDEX IF NOT EXISTS invites_token_hash_idx
    ON platform.invites (token_hash);

CREATE INDEX IF NOT EXISTS invites_tenant_idx
    ON platform.invites (tenant_id, created_at DESC);

-- Tenant-scoped, so it carries the same RLS as everything else with a
-- tenant_id. verify_schema.py asserts this invariant across both schemas and
-- will fail the build if it is omitted.
ALTER TABLE platform.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.invites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invites_tenant_isolation ON platform.invites;
CREATE POLICY invites_tenant_isolation ON platform.invites
    USING (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    );

-- Acceptance is the one path that legitimately reads an invite with no tenant
-- bound: the recipient is not a member yet, so there is nothing to bind. The
-- NULL branch above covers it, exactly as it covers signup in 0013.

GRANT SELECT, INSERT, UPDATE ON platform.invites TO zeus_app;

-- --- grant limit keys ------------------------------------------------------

INSERT INTO platform.plan_limits (plan_id, limit_key, limit_value) VALUES
    ('gi_starter',      'scans_per_month',  3),
    ('gi_growth',       'scans_per_month',  10),
    ('gi_professional', 'scans_per_month',  30),
    ('gi_agency',       'scans_per_month',  100),

    -- Mirrors the matches_per_month rows seeded in 0002 so the visible match
    -- count does not change for anyone when the module id fix lands.
    ('gi_starter',      'matches_visible',  25),
    ('gi_growth',       'matches_visible',  100),
    ('gi_professional', 'matches_visible',  NULL),
    ('gi_agency',       'matches_visible',  NULL)
ON CONFLICT (plan_id, limit_key) DO UPDATE
    SET limit_value = EXCLUDED.limit_value;
