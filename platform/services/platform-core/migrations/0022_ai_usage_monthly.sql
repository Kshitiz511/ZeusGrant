-- 0022: monthly AI usage counter + spend/storage limits (Phase 7, DEC-5).
--
-- Limit checks run on the request path, and platform.ai_usage is append-only
-- and grows by one row per model call, without bound. Summing it per request
-- would get slower every day. This keeps one row per (tenant, module, month),
-- maintained by a trigger on insert into ai_usage, so a limit check is a
-- single primary-key lookup.
--
-- A trigger, not application code: every writer of ai_usage (current and
-- future) updates the counter by construction, and nobody can forget to.
-- The counter can never drift from the ledger, because there is no path that
-- writes one without the other inside the same transaction.
--
-- Rows with tenant_id NULL (shared catalogue enrichment, see Phase 2) belong
-- to no tenant's budget and are not counted.

CREATE TABLE IF NOT EXISTS platform.ai_usage_monthly (
    tenant_id   uuid        NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
    module_id   text        NOT NULL,
    month       date        NOT NULL,
    tokens      bigint      NOT NULL DEFAULT 0,
    -- NULL-priced calls add nothing here; the unpriced-models screen exists to
    -- surface those. A budget can only bound what it can measure.
    cost_usd    numeric(14,6) NOT NULL DEFAULT 0,
    calls       integer     NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, module_id, month)
);

ALTER TABLE platform.ai_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.ai_usage_monthly FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform.ai_usage_monthly;
CREATE POLICY tenant_isolation ON platform.ai_usage_monthly
    USING (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    )
    WITH CHECK (
        nullif(current_setting('app.current_tenant', true), '') IS NULL
        OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
    );

-- The app reads it; only the trigger writes it.
GRANT SELECT ON platform.ai_usage_monthly TO zeus_app;
REVOKE INSERT, UPDATE, DELETE ON platform.ai_usage_monthly FROM zeus_app;

-- SECURITY DEFINER so the trigger can write a table the app role cannot.
-- search_path pinned: a definer function with a mutable search_path can be
-- hijacked by an object planted earlier on the path.
CREATE OR REPLACE FUNCTION platform.bump_ai_usage_monthly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
BEGIN
    IF NEW.tenant_id IS NULL THEN
        RETURN NEW;
    END IF;
    INSERT INTO platform.ai_usage_monthly AS m
           (tenant_id, module_id, month, tokens, cost_usd, calls)
    VALUES (NEW.tenant_id, NEW.module_id,
            date_trunc('month', NEW.created_at AT TIME ZONE 'UTC')::date,
            coalesce(NEW.total_tokens, 0), coalesce(NEW.cost_usd, 0), 1)
    ON CONFLICT (tenant_id, module_id, month) DO UPDATE
       SET tokens     = m.tokens + EXCLUDED.tokens,
           cost_usd   = m.cost_usd + EXCLUDED.cost_usd,
           calls      = m.calls + 1,
           updated_at = now();
    RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION platform.bump_ai_usage_monthly() FROM PUBLIC;

DROP TRIGGER IF EXISTS ai_usage_monthly_bump ON platform.ai_usage;
CREATE TRIGGER ai_usage_monthly_bump
    AFTER INSERT ON platform.ai_usage
    FOR EACH ROW EXECUTE FUNCTION platform.bump_ai_usage_monthly();

-- Backfill from the ledger, so the counter is right from the first request.
-- Production holds zero ai_usage rows today (Phase 2, Q8); this is for any
-- environment that does not.
INSERT INTO platform.ai_usage_monthly (tenant_id, module_id, month, tokens, cost_usd, calls)
SELECT tenant_id, module_id,
       date_trunc('month', created_at AT TIME ZONE 'UTC')::date,
       sum(total_tokens), coalesce(sum(cost_usd), 0), count(*)
  FROM platform.ai_usage
 WHERE tenant_id IS NOT NULL
 GROUP BY 1, 2, 3
ON CONFLICT (tenant_id, module_id, month) DO NOTHING;

-- Seed spend and storage ceilings for Contract Compliance, the module whose
-- AI calls are tenant-attributed. Sized so a tier's ordinary use sits well
-- under the cap; the cap exists to bound a runaway, not to ration normal use.
-- Enterprise has no rows -> unlimited (DEC-10).
INSERT INTO platform.plan_limits (plan_id, limit_key, limit_value) VALUES
    ('cc_starter',      'ai_cost_per_month_usd',    5),
    ('cc_starter',      'storage_mb',             500),
    ('cc_growth',       'ai_cost_per_month_usd',   20),
    ('cc_growth',       'storage_mb',            2000),
    ('cc_professional', 'ai_cost_per_month_usd',   60),
    ('cc_professional', 'storage_mb',           10000),
    ('cc_agency',       'ai_cost_per_month_usd',  200),
    ('cc_agency',       'storage_mb',           50000)
ON CONFLICT (plan_id, limit_key) DO NOTHING;
