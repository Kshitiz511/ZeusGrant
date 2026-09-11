-- ---------------------------------------------------------------------------
-- 0003: Document ingestion + append-only audit log.
--
-- Two additions, both tenant-scoped and both under RLS:
--
--   documents  — metadata for uploaded contract source files. The bytes live
--                in object storage (Storage adapter); only the key is stored
--                here, so the database never holds blobs.
--
--   audit_log  — append-only trail of every mutating action in the module.
--                `zeus_app` is granted INSERT/SELECT only; UPDATE and DELETE
--                are revoked, so the application role cannot rewrite history
--                even if compromised. Retention/pruning is an operator task
--                performed by the migration role.
-- ---------------------------------------------------------------------------

-- --- Documents --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_compliance.documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    contract_id     uuid NOT NULL
                      REFERENCES contract_compliance.contracts(id) ON DELETE CASCADE,
    filename        text NOT NULL,
    content_type    text NOT NULL,
    byte_size       bigint NOT NULL CHECK (byte_size >= 0),
    storage_key     text NOT NULL,
    -- SHA-256 of the raw bytes: dedupe, integrity checks, tamper evidence.
    checksum        text NOT NULL,
    extracted_chars integer NOT NULL DEFAULT 0,
    uploaded_by     uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cc_documents_contract
    ON contract_compliance.documents(contract_id);
CREATE INDEX IF NOT EXISTS idx_cc_documents_tenant
    ON contract_compliance.documents(tenant_id);
-- The same file uploaded twice to one contract is rejected at the DB level.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_documents_contract_checksum
    ON contract_compliance.documents(contract_id, checksum);

-- --- Append-only audit log --------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_compliance.audit_log (
    id          bigserial PRIMARY KEY,
    tenant_id   uuid NOT NULL,
    actor_id    uuid,
    action      text NOT NULL,          -- e.g. contract.created, obligation.updated
    entity_type text NOT NULL,          -- contract | obligation | document
    entity_id   uuid,
    -- Structured detail (changed fields, counts). Never store secrets or the
    -- full document body here.
    detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cc_audit_tenant_time
    ON contract_compliance.audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cc_audit_entity
    ON contract_compliance.audit_log(entity_type, entity_id);

-- --- Contracts: track where the body came from ------------------------------
ALTER TABLE contract_compliance.contracts
    ADD COLUMN IF NOT EXISTS body_source text NOT NULL DEFAULT 'manual'
        CHECK (body_source IN ('manual', 'document'));
ALTER TABLE contract_compliance.contracts
    ADD COLUMN IF NOT EXISTS last_analyzed_at timestamptz;

-- --- Grants -----------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON contract_compliance.documents TO zeus_app;

-- Audit log is insert-and-read only for the application role.
GRANT SELECT, INSERT ON contract_compliance.audit_log TO zeus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON contract_compliance.audit_log FROM zeus_app;
GRANT USAGE, SELECT ON SEQUENCE contract_compliance.audit_log_id_seq TO zeus_app;

-- --- RLS --------------------------------------------------------------------
ALTER TABLE contract_compliance.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON contract_compliance.documents;
CREATE POLICY tenant_isolation ON contract_compliance.documents
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON contract_compliance.audit_log;
CREATE POLICY tenant_isolation ON contract_compliance.audit_log
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
