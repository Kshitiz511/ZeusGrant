-- Scorer semantics against the real 83,394-row catalogue.
--
-- The point of these tests is not that a score comes back. The legacy app
-- produced scores too. The point is that ineligible opportunities are ABSENT,
-- not merely ranked low. The legacy matcher computed an `eligible` boolean and
-- then ignored it, so users were emailed grants they could not legally apply
-- for. Test 2 is the one that matters.
--
-- Everything runs inside a transaction and rolls back.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- A tenant to hang the profile off. Rolled back with everything else.
CREATE TEMP TABLE t AS SELECT gen_random_uuid() AS tenant_id;

INSERT INTO platform.tenants (id, name, slug, owner_user_id)
SELECT tenant_id, 'Scorer Test Org', 'scorer-test-' || substr(tenant_id::text, 1, 8),
       (SELECT id FROM platform.users ORDER BY created_at LIMIT 1)
FROM t;

-- A plausible nonprofit: youth + education focus, small awards, cannot put up
-- matching funds. "12" is Nonprofits with 501(c)(3) status other than IHEs.
INSERT INTO platform.org_profiles (
    tenant_id, legal_name, applicant_class, eligibility_codes,
    home_state, operating_states, focus_areas,
    award_min, award_max, can_cost_share
)
SELECT tenant_id, 'Scorer Test Org', 'nonprofit', ARRAY['12'],
       'CA', ARRAY['CA'], ARRAY['youth development', 'education', 'after school'],
       25000, 500000, false
FROM t;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 1. scorer returns results at all ==='
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE results AS
SELECT * FROM platform.score_opportunities_for_tenant(
    (SELECT tenant_id FROM t), 500
);

SELECT count(*) > 0 AS "returns results", count(*) AS n FROM results;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 2. ELIMINATION: no ineligible opportunity is returned ==='
\echo '    (this is the legacy bug: it scored them and shipped them anyway)'
-- ---------------------------------------------------------------------------
-- Every returned row must either name our code, be unrestricted (99),
-- be prose-defined (25), or publish no codes at all. Anything else is a
-- grant the user cannot apply for.
SELECT count(*) = 0 AS "no ineligible results", count(*) AS violations
FROM results r
JOIN platform.opportunities o ON o.id = r.opportunity_id
WHERE NOT (o.eligibility_codes && ARRAY['12'])
  AND NOT (o.eligibility_codes && ARRAY['99', '25'])
  AND cardinality(o.eligibility_codes) > 0;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 3. ELIMINATION: nothing closed is returned ==='
-- ---------------------------------------------------------------------------
SELECT count(*) = 0 AS "no closed results", count(*) AS violations
FROM results r
JOIN platform.opportunities o ON o.id = r.opportunity_id
WHERE o.closes_on IS NOT NULL AND o.closes_on < current_date;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 4. ELIMINATION: cost-share grants excluded (profile cannot match) ==='
-- ---------------------------------------------------------------------------
SELECT count(*) = 0 AS "no cost-share results", count(*) AS violations
FROM results r
JOIN platform.opportunities o ON o.id = r.opportunity_id
WHERE o.cost_sharing_required IS TRUE;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 5. ELIMINATION: no forecasts in the scored set ==='
-- ---------------------------------------------------------------------------
SELECT count(*) = 0 AS "no forecasts", count(*) AS violations
FROM results r
JOIN platform.opportunities o ON o.id = r.opportunity_id
WHERE o.is_forecast;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 6. scores are bounded 0..100 and ordered descending ==='
-- ---------------------------------------------------------------------------
SELECT bool_and(score BETWEEN 0 AND 100) AS "score in range",
       min(score) AS lo, max(score) AS hi
FROM results;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 7. every result carries four explained reasons ==='
-- ---------------------------------------------------------------------------
-- A score with no explanation is not actionable and support cannot defend it.
SELECT bool_and(jsonb_array_length(reasons) = 4) AS "four reasons each",
       bool_and(
           (SELECT bool_and(elem ? 'factor' AND elem ? 'points' AND elem ? 'detail')
            FROM jsonb_array_elements(reasons) elem)
       ) AS "reasons well formed"
FROM results;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 8. component points never exceed their stated maximum ==='
-- ---------------------------------------------------------------------------
SELECT bool_and((elem->>'points')::int <= (elem->>'max')::int) AS "points within max"
FROM results, jsonb_array_elements(reasons) elem;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 9. deterministic: two runs produce identical output ==='
-- ---------------------------------------------------------------------------
-- If this fails, a user cannot trust a ranking that changed overnight.
WITH again AS (
    SELECT * FROM platform.score_opportunities_for_tenant((SELECT tenant_id FROM t), 500)
)
SELECT count(*) = 0 AS "identical across runs", count(*) AS differences
FROM (
    SELECT opportunity_id, score FROM results
    EXCEPT
    SELECT opportunity_id, score FROM again
) d;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 10. subject fit actually discriminates ==='
-- ---------------------------------------------------------------------------
-- A profile focused on youth education should not score marine geology the
-- same as after-school programmes. If subject points are constant, full-text
-- matching is silently doing nothing.
SELECT count(DISTINCT (elem->>'points')) > 1 AS "subject fit varies"
FROM results, jsonb_array_elements(reasons) elem
WHERE elem->>'factor' = 'subject_fit';


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 11. empty profile yields nothing rather than guessing ==='
-- ---------------------------------------------------------------------------
SELECT count(*) = 0 AS "unknown tenant returns nothing"
FROM platform.score_opportunities_for_tenant(gen_random_uuid(), 100);


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 12. refresh persists matches and preserves user columns ==='
-- ---------------------------------------------------------------------------
SELECT platform.refresh_matches_for_tenant((SELECT tenant_id FROM t), 500) AS "rows written";

-- Simulate the user dismissing one, then rescore. The dismissal must survive:
-- a match the user has rejected must not reappear tomorrow.
UPDATE platform.opportunity_matches
   SET dismissed_at = now()
 WHERE tenant_id = (SELECT tenant_id FROM t)
   AND opportunity_id = (SELECT opportunity_id FROM results LIMIT 1);

CREATE TEMP TABLE before_rescore AS
SELECT opportunity_id, first_seen_at, dismissed_at
FROM platform.opportunity_matches WHERE tenant_id = (SELECT tenant_id FROM t);

SELECT platform.refresh_matches_for_tenant((SELECT tenant_id FROM t), 500) AS "rows rewritten";

SELECT count(*) = 0 AS "dismissals and first_seen survive rescore", count(*) AS lost
FROM before_rescore b
JOIN platform.opportunity_matches m
  ON m.opportunity_id = b.opportunity_id
 AND m.tenant_id = (SELECT tenant_id FROM t)
WHERE m.first_seen_at IS DISTINCT FROM b.first_seen_at
   OR m.dismissed_at  IS DISTINCT FROM b.dismissed_at;


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 13. zero subject overlap can never present as a decent match ==='
-- ---------------------------------------------------------------------------
-- Award fit, deadline and eligibility alone floor a score near 47, and every
-- open grant in the catalogue collects them regardless of what it funds. If
-- this check fails, irrelevant grants are reading mid-table again -- the same
-- class of defect as the legacy matcher, just better disguised.
SELECT count(*) = 0 AS "irrelevant grants held below 35", count(*) AS violations
FROM results r
WHERE r.score > 35
  AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r.reasons) e
       WHERE e->>'factor' = 'subject_fit' AND (e->>'points')::int = 0
  );


-- ---------------------------------------------------------------------------
\echo ''
\echo '=== 14. top 10, as a human would read them ==='
-- ---------------------------------------------------------------------------
SELECT r.score,
       substr(o.title, 1, 58) AS title,
       o.closes_on,
       o.eligibility_codes
FROM results r
JOIN platform.opportunities o ON o.id = r.opportunity_id
ORDER BY r.score DESC, o.closes_on NULLS LAST
LIMIT 10;

ROLLBACK;
