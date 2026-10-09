-- 0021: seed the Contract Compliance ingestion limits (Phase 7).
--
-- pages_per_document, pages_per_month and documents_per_month have been
-- enforced since Phase 7 but seeded on no plan, so every plan was unlimited
-- (DEC-10). These are the first numbers. They are a data change, editable
-- from the operator console (Plans) or per tenant (limit overrides), and the
-- mechanism does not depend on them.
--
-- Sizing: a long federal award agreement with attachments is ~150-300 pages.
-- Each tier allows several such documents a month with headroom, so the caps
-- bound AI spend from abuse without ever blocking a normal customer.
-- Enterprise stays limitless by having no rows (DEC-10, D22).
--
-- ON CONFLICT DO NOTHING: re-running migrations never reverts a value an
-- operator has since edited.

INSERT INTO platform.plan_limits (plan_id, limit_key, limit_value) VALUES
    ('cc_starter',      'pages_per_document',   200),
    ('cc_starter',      'documents_per_month',   20),
    ('cc_starter',      'pages_per_month',      600),

    ('cc_growth',       'pages_per_document',   400),
    ('cc_growth',       'documents_per_month',  100),
    ('cc_growth',       'pages_per_month',     3000),

    ('cc_professional', 'pages_per_document',   600),
    ('cc_professional', 'documents_per_month',  300),
    ('cc_professional', 'pages_per_month',    10000),

    ('cc_agency',       'pages_per_document',   600),
    ('cc_agency',       'documents_per_month', 1000),
    ('cc_agency',       'pages_per_month',    30000)
ON CONFLICT (plan_id, limit_key) DO NOTHING;
