-- 0006: platform-wide AI usage metering and model pricing.
--
-- Answers two questions the platform cannot currently answer at all:
--   "which tenant is consuming how much, and what does it cost us"  (owner)
--   "how much of my allowance have I used, and by whom"             (tenant)
--
-- Lives in `platform`, not a module schema, for three reasons:
--   1. Usage spans every module; a per-module table cannot be summed without
--      a cross-schema union that grows with each module added.
--   2. Quotas and billing are platform-core concerns, next to subscriptions
--      and entitlements.
--   3. The platform owner needs a cross-tenant view. Module tables are under
--      FORCE RLS and zeus_app cannot bypass it, so an owner-level rollup would
--      be impossible without a policy that punches a hole in tenant isolation.
--
-- Like the rest of the `platform` schema this is not under RLS; access is
-- mediated by platform-core, which is the trusted control plane. Tenant-scoped
-- reads go through a repository API that requires a tenant_id argument.

CREATE TABLE IF NOT EXISTS platform.model_pricing (
    model                    text PRIMARY KEY,
    input_per_million_usd    numeric(12, 4) NOT NULL,
    output_per_million_usd   numeric(12, 4) NOT NULL,
    -- Set by the platform owner in the admin dashboard. Seeding a guess would
    -- be worse than leaving it empty: these numbers drive tier pricing, and a
    -- confidently wrong cost is harder to catch than a missing one.
    updated_by               uuid,
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.ai_usage (
    id                  bigserial PRIMARY KEY,
    tenant_id           uuid NOT NULL,
    -- Which team member ran it. The tenant admin needs per-seat attribution
    -- ("per person they have added how much billing").
    actor_id            uuid,
    module_id           text NOT NULL,
    operation           text NOT NULL,
    model               text NOT NULL,

    -- Real counts reported by the provider, never an estimate. A NULL here
    -- means the provider did not return usage, which is a fact worth keeping
    -- distinct from a genuine zero.
    prompt_tokens       integer,
    completion_tokens   integer,
    total_tokens        integer GENERATED ALWAYS AS
                            (COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)) STORED,

    -- Priced at write time from the rate then in effect, so later price changes
    -- do not silently rewrite historical cost. NULL means the model had no
    -- configured price -- recorded honestly rather than as 0.00.
    cost_usd            numeric(12, 6),

    latency_ms          integer,
    succeeded           boolean NOT NULL DEFAULT true,
    error               text,
    -- Links a fan-out of chunk jobs back to one user-visible operation.
    request_id          uuid,
    created_at          timestamptz NOT NULL DEFAULT now()
);

-- Every rollup is "this tenant, this period", so lead with tenant_id.
CREATE INDEX IF NOT EXISTS ai_usage_tenant_created_idx
    ON platform.ai_usage (tenant_id, created_at DESC);

-- The owner's cross-tenant view sorts by time across all tenants.
CREATE INDEX IF NOT EXISTS ai_usage_created_idx
    ON platform.ai_usage (created_at DESC);

-- Per-seat attribution within a tenant.
CREATE INDEX IF NOT EXISTS ai_usage_tenant_actor_idx
    ON platform.ai_usage (tenant_id, actor_id, created_at DESC);

-- Usage records are billing evidence: append-only, like the audit log. A bug
-- that "cleans up" usage rows would destroy the basis for an invoice.
GRANT SELECT, INSERT ON platform.ai_usage TO zeus_app;
GRANT USAGE, SELECT ON SEQUENCE platform.ai_usage_id_seq TO zeus_app;
REVOKE UPDATE, DELETE, TRUNCATE ON platform.ai_usage FROM zeus_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.model_pricing TO zeus_app;
