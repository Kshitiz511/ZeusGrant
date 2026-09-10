-- =============================================================================
-- Zeus Platform Core — Phase 1 schema
-- Multi-tenant identity, billing and entitlements. Lives in its own schema
-- (`platform`) so module services can own separate schemas (schema-per-service).
-- Mirrors architecture.md §2.3.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS platform;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- --- Tenants ----------------------------------------------------------------
-- A tenant is the unit of isolation. The purchaser becomes its owner.
CREATE TABLE platform.tenants (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    slug          text UNIQUE NOT NULL,
    owner_user_id uuid NOT NULL,
    status        text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deleted')),
    stripe_customer_id text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- --- Users ------------------------------------------------------------------
-- Mirror of the auth provider's user (Supabase auth.users). We store the id
-- and email locally so memberships and ownership work without cross-schema FKs.
CREATE TABLE platform.users (
    id            uuid PRIMARY KEY,          -- equals auth.users.id
    email         text UNIQUE NOT NULL,
    auth_provider text NOT NULL DEFAULT 'supabase',
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- --- Memberships ------------------------------------------------------------
CREATE TABLE platform.memberships (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'member'
                 CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, user_id)
);
CREATE INDEX idx_memberships_user ON platform.memberships(user_id);
CREATE INDEX idx_memberships_tenant ON platform.memberships(tenant_id);

-- --- Modules (the sellable services) ---------------------------------------
CREATE TABLE platform.modules (
    id   text PRIMARY KEY,   -- grant_intelligence | contract_compliance | audit_compliance
    name text NOT NULL,
    slug text UNIQUE NOT NULL
);

-- --- Plans (per module) -----------------------------------------------------
CREATE TABLE platform.plans (
    id              text PRIMARY KEY,             -- e.g. gi_growth
    module_id       text NOT NULL REFERENCES platform.modules(id),
    name            text NOT NULL,
    monthly_cents   integer,
    annual_cents    integer,
    stripe_price_id_monthly text,
    stripe_price_id_annual  text,
    is_active       boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_plans_module ON platform.plans(module_id);

-- --- Plan limits (key/value; drives entitlement claims) --------------------
CREATE TABLE platform.plan_limits (
    plan_id     text NOT NULL REFERENCES platform.plans(id) ON DELETE CASCADE,
    limit_key   text NOT NULL,
    limit_value integer,             -- NULL means unlimited
    PRIMARY KEY (plan_id, limit_key)
);

-- --- Subscriptions (one per tenant per module) -----------------------------
CREATE TABLE platform.subscriptions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    module_id   text NOT NULL REFERENCES platform.modules(id),
    plan_id     text NOT NULL REFERENCES platform.plans(id),
    status      text NOT NULL
                  CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
    stripe_subscription_id text UNIQUE,
    environment text NOT NULL DEFAULT 'live',
    current_period_end timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, module_id, environment)
);
CREATE INDEX idx_subscriptions_tenant ON platform.subscriptions(tenant_id);

-- --- Entitlements (derived, cached snapshot of access) ---------------------
-- Single source of truth the guard reads. Recomputed on billing changes.
CREATE TABLE platform.entitlements (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    module_id   text NOT NULL REFERENCES platform.modules(id),
    plan_id     text REFERENCES platform.plans(id),
    status      text NOT NULL,           -- active | trialing | past_due | none
    limits      jsonb NOT NULL DEFAULT '{}'::jsonb,
    refreshed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, module_id)
);
CREATE INDEX idx_entitlements_tenant ON platform.entitlements(tenant_id);

-- --- Platform config (admin-managed key/value; secrets encrypted) ----------
-- `is_secret` rows store SecretBox ciphertext (zsb1:...) in `value`.
CREATE TABLE platform.platform_config (
    key        text PRIMARY KEY,
    value      text,
    is_secret  boolean NOT NULL DEFAULT false,
    updated_by uuid,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- --- Prompt registry (versioned, live-editable) ----------------------------
CREATE TABLE platform.prompt_registry (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,             -- logical prompt id, e.g. contract.extract
    version    integer NOT NULL,
    body       text NOT NULL,
    is_active  boolean NOT NULL DEFAULT false,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, version)
);
CREATE INDEX idx_prompt_active ON platform.prompt_registry(name) WHERE is_active;

-- --- Seed the three sellable modules ---------------------------------------
INSERT INTO platform.modules (id, name, slug) VALUES
    ('grant_intelligence',  'Grant Intelligence Suite',            'grant-intelligence'),
    ('contract_compliance', 'Contract Compliance Manager',         'contract-compliance'),
    ('audit_compliance',    'Audit Compliance & Documentation Vault', 'audit-compliance')
ON CONFLICT (id) DO NOTHING;
