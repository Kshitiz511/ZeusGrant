-- =============================================================================
-- Contract Compliance module — schema (schema-per-service).
-- Owns its own `contract_compliance` schema; references tenants only by id
-- (no cross-schema FK, keeping the service independently deployable).
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS contract_compliance;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- --- Contracts --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contract_compliance.contracts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL,
    title        text NOT NULL,
    counterparty text,
    body         text,                 -- raw contract text (source for AI extraction)
    status       text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'active', 'archived')),
    created_by   uuid,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cc_contracts_tenant
    ON contract_compliance.contracts(tenant_id);

-- --- Obligations (extracted tasks) -----------------------------------------
CREATE TABLE IF NOT EXISTS contract_compliance.obligations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id   uuid NOT NULL REFERENCES contract_compliance.contracts(id) ON DELETE CASCADE,
    tenant_id     uuid NOT NULL,
    description   text NOT NULL,
    due_date      date,
    responsible   text,
    priority      text NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high')),
    status        text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'done')),
    source        text NOT NULL DEFAULT 'manual'   -- manual | ai
                    CHECK (source IN ('manual', 'ai')),
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cc_obligations_contract
    ON contract_compliance.obligations(contract_id);
CREATE INDEX IF NOT EXISTS idx_cc_obligations_tenant
    ON contract_compliance.obligations(tenant_id);

-- --- Seed the default AI extraction prompt (versioned, live-editable) -------
-- The prompt gives the model the exact JSON shape and a worked example.
-- Smaller/open models (e.g. gemma3) ignore a raw JSON-schema dump but follow
-- an explicit shape + example reliably, so we spell it out here.
INSERT INTO platform.prompt_registry (name, version, body, is_active)
VALUES (
    'contract.extract_obligations',
    2,
    'You are a contract compliance analyst. Read the contract text and extract every concrete obligation, deliverable, or deadline.
Respond with ONLY a JSON object of this exact shape (no prose, no markdown fences):
{"obligations": [{"description": "string", "due_date": "YYYY-MM-DD or null", "responsible": "string or null", "priority": "low|medium|high"}]}
Example:
{"obligations": [{"description": "Deliver quarterly report", "due_date": "2026-03-31", "responsible": "Vendor", "priority": "high"}]}
If there are no obligations, return {"obligations": []}.',
    true
)
ON CONFLICT (name, version) DO NOTHING;

-- Deactivate any older version so exactly one active prompt remains.
UPDATE platform.prompt_registry
   SET is_active = false
 WHERE name = 'contract.extract_obligations' AND version < 2;
