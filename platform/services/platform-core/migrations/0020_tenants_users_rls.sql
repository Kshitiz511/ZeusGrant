-- 0020: row-level security on platform.tenants and platform.users (D16).
--
-- Every table with a tenant_id column has been row-isolated since 0013. These
-- two were not, because they are keyed by id and must be readable before any
-- tenant is bound (signup, login, token exchange, invite acceptance, the
-- operator console). Isolation for them was an application property only.
--
-- The policy follows 0013 exactly: when no tenant is bound the row is visible
-- (the unscoped auth and admin paths keep working unchanged); once a request
-- binds a tenant, the database itself narrows what can be seen:
--
--   tenants -- only the bound tenant's own row.
--   users   -- only users who are members of the bound tenant.
--
-- So a query bug on a tenant-scoped path can no longer enumerate other
-- organisations or their people; the database refuses to return them.
--
-- nullif() before the cast: Postgres does not guarantee OR short-circuits, and
-- casting '' to uuid raises.

ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.tenants;
CREATE POLICY tenant_isolation ON platform.tenants
    USING (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR id = nullif(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR id = nullif(current_setting('app.current_tenant', true), '')::uuid
    );

ALTER TABLE platform.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.users;
-- memberships is itself RLS'd to the bound tenant, so the subquery can only
-- ever see that tenant's memberships.
CREATE POLICY tenant_isolation ON platform.users
    USING (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR EXISTS (
            SELECT 1 FROM platform.memberships m
             WHERE m.user_id = platform.users.id
               AND m.tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
        )
    )
    WITH CHECK (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR EXISTS (
            SELECT 1 FROM platform.memberships m
             WHERE m.user_id = platform.users.id
               AND m.tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
        )
    );
