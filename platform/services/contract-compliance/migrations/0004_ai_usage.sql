-- 0004: per-tenant AI usage tracking.
--
-- architecture.md requires per-tenant AI cost metrics. Without this there is no
-- way to answer "which tenant is burning the model budget", to bill for usage,
-- or to detect a runaway loop before the invoice arrives.
--
-- Written to the module schema (not platform) because usage is recorded in the
-- tenant's RLS context during a normal request.

CREATE TABLE IF NOT EXISTS contract_compliance.ai_usage (
    id                      bigserial PRIMARY KEY,
    tenant_id               uuid NOT NULL,
    contract_id             uuid REFERENCES contract_compliance.contracts(id) ON DELETE SET NULL,
    actor_id                uuid,
    operation               text NOT NULL,
    model                   text NOT NULL,
    chunks                  integer NOT NULL DEFAULT 1,
    chunks_failed           integer NOT NULL DEFAULT 0,
    estimated_input_tokens  integer NOT NULL DEFAULT 0,
    obligations_found       integer NOT NULL DEFAULT 0,
    obligations_dropped     integer NOT NULL DEFAULT 0,
    latency_ms              integer NOT NULL DEFAULT 0,
    succeeded               boolean NOT NULL DEFAULT true,
    error                   text,
    created_at              timestamptz NOT NULL DEFAULT now()
);

-- Cost rollups are always "this tenant, this period", so lead with tenant_id.
CREATE INDEX IF NOT EXISTS ai_usage_tenant_created_idx
    ON contract_compliance.ai_usage (tenant_id, created_at DESC);

ALTER TABLE contract_compliance.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.ai_usage FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON contract_compliance.ai_usage;
CREATE POLICY tenant_isolation ON contract_compliance.ai_usage
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Usage records are evidence for billing: append-only, like the audit log.
GRANT SELECT, INSERT ON contract_compliance.ai_usage TO zeus_app;
GRANT USAGE, SELECT ON SEQUENCE contract_compliance.ai_usage_id_seq TO zeus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON contract_compliance.ai_usage FROM zeus_app;
