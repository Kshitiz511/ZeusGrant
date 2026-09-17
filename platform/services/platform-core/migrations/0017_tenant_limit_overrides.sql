-- 0017: per-tenant limit overrides.
--
-- The problem this solves: giving one customer a higher ceiling currently
-- requires inventing a plan for them. That pollutes the catalogue with
-- one-customer plans, each of which then needs Stripe price ids it will never
-- use, and it makes "what plans do we sell" impossible to answer honestly.
--
-- An override says: this tenant, this limit key, this value, and here is why.
-- Resolution order is override -> plan limit -> unlimited, so an override is
-- always a deliberate exception sitting on top of a plan the tenant really has.
--
-- ---------------------------------------------------------------------------
-- WHY `reason` IS NOT NULL
-- ---------------------------------------------------------------------------
-- An override with no recorded reason becomes permanent by default: nobody
-- later can tell whether it was a sales concession, an apology for an outage,
-- or a debugging change somebody forgot to revert. Requiring the reason at
-- write time is the only moment anyone actually knows it. It costs one field
-- and saves the question "why does this customer have 500 scans?".
--
-- ---------------------------------------------------------------------------
-- WHY limit_value IS NULLABLE
-- ---------------------------------------------------------------------------
-- NULL means unlimited, matching plan_limits and the rest of the limit system.
-- It is therefore NOT the same as having no override row at all: no row means
-- "fall through to the plan", NULL means "explicitly uncapped". Collapsing
-- those two would make it impossible to lift a cap without editing the plan.

CREATE TABLE IF NOT EXISTS platform.tenant_limit_overrides (
    tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    limit_key    text NOT NULL,

    -- NULL = explicitly unlimited. See note above.
    limit_value  integer,

    reason       text NOT NULL,

    -- Nullable and ON DELETE SET NULL for the same reason as admin_audit: the
    -- override must outlive the operator who set it. It is also mirrored into
    -- admin_audit at write time, so this column is a convenience for the UI
    -- rather than the record of who did it.
    set_by       uuid REFERENCES platform.users(id) ON DELETE SET NULL,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- One value per key per tenant. Upserting on this key makes "set this
    -- override" idempotent rather than accumulating a history of rows that the
    -- resolver would then have to disambiguate.
    PRIMARY KEY (tenant_id, limit_key)
);

COMMENT ON TABLE platform.tenant_limit_overrides IS
    'Per-tenant exceptions to plan limits. Resolution: override -> plan limit -> '
    'unlimited. A NULL limit_value means explicitly unlimited, which is not the '
    'same as having no row (that falls through to the plan).';

COMMENT ON COLUMN platform.tenant_limit_overrides.reason IS
    'Required. Without it nobody can later tell a sales concession from a '
    'forgotten debugging change, and the override becomes permanent by default.';

-- RLS, consistent with every other tenant-scoped table (0013). Admin requests
-- bind no tenant and so match the NULL branch, which is what lets an operator
-- read and write overrides across tenants. A tenant-scoped request sees only
-- its own, which is what the entitlement refresh needs.
ALTER TABLE platform.tenant_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_limit_overrides FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.tenant_limit_overrides;
CREATE POLICY tenant_isolation ON platform.tenant_limit_overrides
    USING (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.tenant_limit_overrides TO zeus_app;

-- ---------------------------------------------------------------------------
-- Suspension needs an index on status
-- ---------------------------------------------------------------------------
-- The admin tenant list filters and sorts on status. Partial, because
-- non-active tenants are the rare case and the common query is "show me the
-- ones that are not healthy".
CREATE INDEX IF NOT EXISTS tenants_status_idx
    ON platform.tenants (status)
    WHERE status <> 'active';

COMMENT ON COLUMN platform.tenants.status IS
    'active | suspended | deleted. A non-active tenant grants no module '
    'entitlements, so its members are refused at the request guard. Work already '
    'in the job ledger still drains: the worker authenticates by shared secret '
    'and never re-checks entitlements, so suspension stops new work without '
    'destroying work already accepted.';
