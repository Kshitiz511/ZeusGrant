-- How expensive is scoring, really, and how much does elimination actually cut?
-- "Do not overload the server" is a measurable claim, so measure it.

\timing on

BEGIN;

CREATE TEMP TABLE t AS SELECT gen_random_uuid() AS tenant_id;

INSERT INTO platform.tenants (id, name, slug, owner_user_id)
SELECT tenant_id, 'Perf Test Org', 'perf-' || substr(tenant_id::text, 1, 8),
       (SELECT id FROM platform.users ORDER BY created_at LIMIT 1)
FROM t;

INSERT INTO platform.org_profiles (
    tenant_id, legal_name, applicant_class, eligibility_codes,
    home_state, operating_states, focus_areas, award_min, award_max, can_cost_share
)
SELECT tenant_id, 'Perf Test Org', 'nonprofit', ARRAY['12'],
       'CA', ARRAY['CA'], ARRAY['youth development', 'education', 'after school'],
       25000, 500000, false
FROM t;

\echo ''
\echo '=== funnel: how much does each stage remove? ==='
SELECT
    (SELECT count(*) FROM platform.opportunities) AS total_catalogue,
    (SELECT count(*) FROM platform.opportunities WHERE NOT is_forecast) AS non_forecast,
    (SELECT count(*) FROM platform.opportunities
      WHERE NOT is_forecast
        AND (closes_on IS NULL OR closes_on >= current_date)
        AND (archives_on IS NULL OR archives_on >= current_date)) AS still_open,
    (SELECT count(*) FROM platform.opportunities o
      WHERE NOT o.is_forecast
        AND (o.closes_on IS NULL OR o.closes_on >= current_date)
        AND (o.archives_on IS NULL OR o.archives_on >= current_date)
        AND (o.eligibility_codes && ARRAY['12']
             OR o.eligibility_codes && ARRAY['99','25']
             OR cardinality(o.eligibility_codes) = 0)
        AND o.cost_sharing_required IS NOT TRUE) AS after_elimination;

\echo ''
\echo '=== scoring cost, unlimited (the real work) ==='
SELECT count(*) AS scored FROM platform.score_opportunities_for_tenant(
    (SELECT tenant_id FROM t), 100000);

\echo ''
\echo '=== scoring cost, page-sized limit 50 (what an API call does) ==='
SELECT count(*) FROM platform.score_opportunities_for_tenant(
    (SELECT tenant_id FROM t), 50);

\echo ''
\echo '=== persist cost ==='
SELECT platform.refresh_matches_for_tenant((SELECT tenant_id FROM t), 100000) AS persisted;

\echo ''
\echo '=== reading persisted matches back, which is what the UI does ==='
SELECT count(*) FROM platform.opportunity_matches
 WHERE tenant_id = (SELECT tenant_id FROM t) AND dismissed_at IS NULL;

\echo ''
\echo '=== score distribution: is the floor misleadingly high? ==='
SELECT width_bucket(score, 0, 100, 10) * 10 AS bucket, count(*)
FROM platform.opportunity_matches
WHERE tenant_id = (SELECT tenant_id FROM t)
GROUP BY 1 ORDER BY 1;

\echo ''
\echo '=== how many have literally zero subject relevance? ==='
SELECT count(*) FILTER (WHERE (elem->>'points')::int = 0) AS zero_subject_fit,
       count(*) AS total
FROM platform.opportunity_matches m, jsonb_array_elements(m.reasons) elem
WHERE m.tenant_id = (SELECT tenant_id FROM t) AND elem->>'factor' = 'subject_fit';

ROLLBACK;
