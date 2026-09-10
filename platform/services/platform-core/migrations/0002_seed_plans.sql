-- =============================================================================
-- Zeus Platform Core — Phase 2 seed: plans, plan limits and Stripe price ids.
-- Ports the legacy per-module tiers (src/lib/modules.ts + entitlements.ts) into
-- the database so `plan_for_price` resolves and the entitlement guard has real
-- limits to enforce. Idempotent (safe to re-run).
--
-- Price ids use the legacy placeholder convention `<mod>_<tier>_<cycle>`
-- (e.g. cc_growth_monthly). Swap these for live Stripe price ids via the admin
-- config once the Stripe products exist; nothing is hardcoded in app code.
-- =============================================================================

-- --- Plans ------------------------------------------------------------------
-- monthly_cents / annual_cents mirror the legacy pricing. Annual = 17% off.
INSERT INTO platform.plans
    (id, module_id, name, monthly_cents, annual_cents,
     stripe_price_id_monthly, stripe_price_id_annual, is_active)
VALUES
    -- Grant Intelligence -----------------------------------------------------
    ('gi_starter',      'grant_intelligence', 'Starter',       4900,   48804,  'gi_starter_monthly',      'gi_starter_annual',      true),
    ('gi_growth',       'grant_intelligence', 'Growth',        9900,   98604,  'gi_growth_monthly',       'gi_growth_annual',       true),
    ('gi_professional', 'grant_intelligence', 'Professional', 19900,  198204,  'gi_professional_monthly', 'gi_professional_annual', true),
    ('gi_agency',       'grant_intelligence', 'Agency',       39900,  397404,  'gi_agency_monthly',       'gi_agency_annual',       true),
    ('gi_enterprise',   'grant_intelligence', 'Enterprise',    NULL,     NULL,  NULL,                      NULL,                     true),
    -- Contract Compliance ----------------------------------------------------
    ('cc_starter',      'contract_compliance', 'Starter',      3900,   38844,  'cc_starter_monthly',      'cc_starter_annual',      true),
    ('cc_growth',       'contract_compliance', 'Growth',       7900,   78684,  'cc_growth_monthly',       'cc_growth_annual',       true),
    ('cc_professional', 'contract_compliance', 'Professional',14900,  148404,  'cc_professional_monthly', 'cc_professional_annual', true),
    ('cc_agency',       'contract_compliance', 'Agency',      29900,  297804,  'cc_agency_monthly',       'cc_agency_annual',       true),
    ('cc_enterprise',   'contract_compliance', 'Enterprise',    NULL,    NULL,  NULL,                      NULL,                     true),
    -- Audit Compliance -------------------------------------------------------
    ('ac_starter',      'audit_compliance', 'Starter',         5900,   58764,  'ac_starter_monthly',      'ac_starter_annual',      true),
    ('ac_growth',       'audit_compliance', 'Growth',         12900,  128484,  'ac_growth_monthly',       'ac_growth_annual',       true),
    ('ac_professional', 'audit_compliance', 'Professional',   24900,  247884,  'ac_professional_monthly', 'ac_professional_annual', true),
    ('ac_agency',       'audit_compliance', 'Agency',         44900,  447084,  'ac_agency_monthly',       'ac_agency_annual',       true),
    ('ac_enterprise',   'audit_compliance', 'Enterprise',       NULL,    NULL,  NULL,                      NULL,                     true)
ON CONFLICT (id) DO UPDATE
  SET module_id = EXCLUDED.module_id,
      name = EXCLUDED.name,
      monthly_cents = EXCLUDED.monthly_cents,
      annual_cents = EXCLUDED.annual_cents,
      stripe_price_id_monthly = EXCLUDED.stripe_price_id_monthly,
      stripe_price_id_annual = EXCLUDED.stripe_price_id_annual,
      is_active = EXCLUDED.is_active;

-- --- Plan limits ------------------------------------------------------------
-- limit_value NULL means unlimited. Keys are module-relevant; the guard and
-- services read these by key. Contract Compliance uses `contracts_max`.
INSERT INTO platform.plan_limits (plan_id, limit_key, limit_value) VALUES
    -- Grant Intelligence: matches, drafts, seats, workspaces
    ('gi_starter',      'matches_per_month', 25),
    ('gi_starter',      'proposal_drafts_per_month', 1),
    ('gi_starter',      'team_seats', 1),
    ('gi_growth',       'matches_per_month', 100),
    ('gi_growth',       'proposal_drafts_per_month', 5),
    ('gi_growth',       'team_seats', 3),
    ('gi_professional', 'matches_per_month', NULL),
    ('gi_professional', 'proposal_drafts_per_month', 15),
    ('gi_professional', 'team_seats', 10),
    ('gi_agency',       'matches_per_month', NULL),
    ('gi_agency',       'proposal_drafts_per_month', 40),
    ('gi_agency',       'team_seats', 25),
    ('gi_agency',       'client_workspaces', 10),
    -- Contract Compliance: number of contracts under management
    ('cc_starter',      'contracts_max', 1),
    ('cc_starter',      'team_seats', 1),
    ('cc_growth',       'contracts_max', 5),
    ('cc_growth',       'team_seats', 3),
    ('cc_professional', 'contracts_max', 15),
    ('cc_professional', 'team_seats', 10),
    ('cc_agency',       'contracts_max', NULL),
    ('cc_agency',       'team_seats', 25),
    -- Audit Compliance: number of evidence vaults
    ('ac_starter',      'vaults_max', 1),
    ('ac_growth',       'vaults_max', 5),
    ('ac_professional', 'vaults_max', 15),
    ('ac_agency',       'vaults_max', NULL)
ON CONFLICT (plan_id, limit_key) DO UPDATE
  SET limit_value = EXCLUDED.limit_value;
