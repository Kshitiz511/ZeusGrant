-- 0015: seed model pricing, and allow usage that belongs to no tenant.
--
-- Two changes, both prerequisites for showing anyone a cost figure.
--
-- 1. SEEDING model_pricing.
--
-- 0006 deliberately left this table empty, arguing that "seeding a guess would
-- be worse than leaving it empty". That reasoning was right about guesses and
-- wrong about the consequence: with no rows, compute_cost() returns NULL for
-- every call, so cost_usd is NULL on every row in the system and no spend
-- figure can be shown to anyone -- tenant or owner.
--
-- The resolution is not to guess. These are the provider's published list
-- prices, recorded with the date they were taken so a stale rate is visible
-- rather than assumed. Phase 5 makes them editable in the admin panel, which
-- is where a negotiated or changed rate belongs. Until then this is a
-- starting point that is checkable, not a placeholder.
--
-- Prices are USD per 1M tokens, taken from OpenAI's published API pricing on
-- 2026-09-16. Cached-input rates are NOT modelled: we do not currently read
-- cache-hit counts back from the provider, and a discount we cannot measure
-- would understate real cost. Erring toward over-reporting is the safe
-- direction for a budget guard.
--
-- 2. tenant_id BECOMES NULLABLE.
--
-- Grant catalogue enrichment reads eligibility prose for opportunities in the
-- shared catalogue. That work is not done for any one tenant -- every tenant
-- benefits from the same enriched record -- and the job that runs it has no
-- tenant context at all.
--
-- Three options were available: invent a sentinel tenant, attribute the cost
-- to whichever tenant happened to trigger the batch, or record honestly that
-- the cost is platform-wide. The second is the tempting one and the worst: it
-- would put shared infrastructure cost on one customer's usage page, which is
-- wrong on the customer's screen and wrong in any budget guard built on it.
--
-- So NULL means "platform-wide cost, attributable to no tenant". Tenant-scoped
-- reads filter on tenant_id and therefore exclude these rows automatically;
-- the owner's cross-tenant rollup includes them, which is the only place they
-- are meaningful.
--
-- Safe to apply: platform.ai_usage has zero rows in every environment at the
-- time of writing, so there is no existing data to reinterpret.

ALTER TABLE platform.ai_usage ALTER COLUMN tenant_id DROP NOT NULL;

-- Partial index for the tenant-scoped rollups. The existing
-- ai_usage_tenant_created_idx still serves these, but making the
-- attributable/unattributable split explicit keeps the platform-wide rows out
-- of the index that tenant queries walk.
CREATE INDEX IF NOT EXISTS ai_usage_platform_created_idx
    ON platform.ai_usage (created_at DESC)
    WHERE tenant_id IS NULL;

COMMENT ON COLUMN platform.ai_usage.tenant_id IS
    'NULL means platform-wide cost attributable to no single tenant, such as '
    'shared catalogue enrichment. Tenant rollups filter this out; the owner''s '
    'cross-tenant rollup includes it.';

-- Model names are stored unqualified ("gpt-5-mini", not "openai:gpt-5-mini").
-- The recorder normalises before both lookup and insert, because the two
-- call sites disagreed: contract extraction passed the bare name while grant
-- enrichment passed a "provider:model" string. Left alone, half the rows
-- would miss every price row and group separately in every rollup.
INSERT INTO platform.model_pricing (model, input_per_million_usd, output_per_million_usd)
VALUES
    -- Current default (ZEUS_LLM_MODEL), and the only model the platform is
    -- tested against today.
    ('gpt-5-mini',   0.2500,   2.0000),
    ('gpt-5-nano',   0.0500,   0.4000),
    ('gpt-5',        1.2500,  10.0000),
    ('gpt-5.1',      1.2500,  10.0000),
    ('gpt-5.2',      1.7500,  14.0000),
    ('gpt-5.2-pro', 21.0000, 168.0000),
    ('gpt-5.4-mini', 0.7500,   4.5000),
    ('gpt-5.4-nano', 0.2000,   1.2500)
ON CONFLICT (model) DO NOTHING;

-- DO NOTHING rather than DO UPDATE: once the owner edits a price in the admin
-- panel, re-running migrations must not silently revert it to the list price.
