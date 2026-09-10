-- ---------------------------------------------------------------------------
-- 0002: Row-Level Security for tenant data.
--
-- Defense in depth: repositories already filter by tenant_id, but RLS makes
-- Postgres itself the last line of defense — a buggy or missing WHERE clause
-- returns zero rows instead of another tenant's data.
--
-- Mechanics:
--   * Services connect as `zeus_app` (NOSUPERUSER, not the table owner), so
--     RLS policies actually apply. Superusers and owners bypass RLS, which is
--     why migrations keep running as `zeus` unaffected.
--   * The Postgres adapter pins `app.current_tenant` per query with
--     set_config(..., is_local => true) inside a transaction. Unset context
--     (current_setting returns NULL) matches no rows — fail closed.
-- ---------------------------------------------------------------------------

-- --- application role (idempotent; password is LOCAL DEV ONLY) --------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
        CREATE ROLE zeus_app LOGIN PASSWORD 'zeus_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO zeus_app;
GRANT USAGE ON SCHEMA contract_compliance TO zeus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO zeus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA contract_compliance TO zeus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO zeus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA contract_compliance TO zeus_app;
-- Future tables created by the migration role inherit the grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA platform
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zeus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA contract_compliance
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zeus_app;

-- --- RLS on module tenant data ----------------------------------------------
ALTER TABLE contract_compliance.contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.obligations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON contract_compliance.contracts;
CREATE POLICY tenant_isolation ON contract_compliance.contracts
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON contract_compliance.obligations;
CREATE POLICY tenant_isolation ON contract_compliance.obligations
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
