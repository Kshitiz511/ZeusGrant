-- What does each read path actually cost? Measured, not assumed.
--
-- The question behind this: if reading matches means scanning 800+ documents
-- every time, the system does not scale. These numbers answer that directly.

\timing on

\echo ''
\echo '=== A. Reading a page of matches (what the UI does on every page load) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.score, m.reasons, o.title, o.closes_on, o.agency_name
  FROM platform.opportunity_matches m
  JOIN platform.opportunities o ON o.id = m.opportunity_id
 WHERE m.tenant_id = (SELECT tenant_id FROM platform.opportunity_matches LIMIT 1)
   AND m.dismissed_at IS NULL
   AND (o.closes_on IS NULL OR o.closes_on >= current_date)
 ORDER BY m.score DESC
 LIMIT 50;

\echo ''
\echo '=== B. Scoring from scratch (what a scan does, in a background job) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM platform.score_opportunities_for_tenant(
    (SELECT tenant_id FROM platform.org_profiles LIMIT 1), 500
);

\echo ''
\echo '=== C. Catalogue search (full text over 83,394 rows) ==='
EXPLAIN (ANALYZE, BUFFERS)
SELECT o.id, o.title
  FROM platform.opportunities o
 WHERE (setweight(to_tsvector('english', coalesce(o.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(o.description, '')), 'B'))
       @@ websearch_to_tsquery('english', 'youth education')
   AND (o.closes_on IS NULL OR o.closes_on >= current_date)
 LIMIT 50;

\echo ''
\echo '=== D. Index sizes (how much of this stays in memory) ==='
SELECT
    relname AS object,
    pg_size_pretty(pg_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'platform'
  AND (relname LIKE 'opportunit%' OR relname LIKE 'jobs%' OR relname LIKE 'enrichment%')
ORDER BY pg_relation_size(c.oid) DESC
LIMIT 12;

\echo ''
\echo '=== E. Row counts by table ==='
SELECT 'opportunities' AS t, count(*) FROM platform.opportunities
UNION ALL SELECT 'opportunity_matches', count(*) FROM platform.opportunity_matches
UNION ALL SELECT 'org_profiles', count(*) FROM platform.org_profiles
UNION ALL SELECT 'jobs', count(*) FROM platform.jobs
UNION ALL SELECT 'enrichment_cache', count(*) FROM platform.enrichment_cache;
