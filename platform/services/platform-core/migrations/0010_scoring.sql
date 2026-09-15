-- 0010: deterministic match scoring.
--
-- Scoring is SQL, not Python, and certainly not an LLM. Three reasons:
--
--   1. It must be reproducible. The same profile against the same catalogue
--      must give the same score every time, or a user cannot trust a ranking
--      that changed overnight, and support cannot explain one.
--   2. It must be set-based. Scoring N tenants against ~900 open opportunities
--      is one statement per tenant, not 900 round trips. The legacy app pulled
--      the whole table into the browser and looped in JavaScript.
--   3. It must be cheap. An LLM call per opportunity would cost real money per
--      page view and take minutes. The LLM's place is interpreting prose that
--      cannot be computed -- see the enrichment job -- never ranking.
--
-- Eliminate first, then score. Hard filters run as a WHERE clause against
-- indexed columns, so only genuinely applicable opportunities are ever ranked.
-- This is the opposite of the legacy design, which computed an `eligible`
-- boolean, ignored it, and emailed users grants they could not legally apply
-- for.

-- Bump when the rules below change. Stored on every match row so an old score
-- can still be explained under the rules that produced it, and so a rules
-- change can be rolled out by rescoring rather than by silent overwrite.
CREATE OR REPLACE FUNCTION platform.scorer_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;


-- ---------------------------------------------------------------------------
-- Subject relevance
-- ---------------------------------------------------------------------------
-- Turns an organisation's focus areas into a safe tsquery. websearch_to_tsquery
-- never raises on malformed input, which matters because these strings come
-- from a user-editable profile; to_tsquery would throw on a stray operator and
-- take the whole scoring run down with it.
CREATE OR REPLACE FUNCTION platform.focus_tsquery(_focus_areas text[])
RETURNS tsquery
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN _focus_areas IS NULL OR cardinality(_focus_areas) = 0 THEN NULL
        ELSE websearch_to_tsquery('english', array_to_string(_focus_areas, ' OR '))
    END;
$$;


-- ---------------------------------------------------------------------------
-- The scoring query
-- ---------------------------------------------------------------------------
-- 100 points, four components:
--
--   subject fit       40   does this fund what we actually do
--   award fit         25   can we absorb and administer this amount
--   deadline runway   20   is there time to write a credible application
--   eligibility fit   15   how precisely do we match who they want
--
-- Subject fit carries the most weight because it is the question a human asks
-- first. The others are constraints; this one is the point.
CREATE OR REPLACE FUNCTION platform.score_opportunities_for_tenant(
    _tenant_id uuid,
    _limit integer DEFAULT 500
)
RETURNS TABLE (
    opportunity_id uuid,
    score integer,
    reasons jsonb
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    _p platform.org_profiles;
    _q tsquery;
BEGIN
    SELECT * INTO _p FROM platform.org_profiles WHERE tenant_id = _tenant_id;
    IF _p.tenant_id IS NULL THEN
        RETURN;  -- No profile: no matches. Guessing would be worse than nothing.
    END IF;

    _q := platform.focus_tsquery(_p.focus_areas);

    RETURN QUERY
    WITH candidates AS (
        SELECT o.*
          FROM platform.opportunities o
         WHERE NOT o.is_forecast
           -- Open, or genuinely rolling. A missing close date on an archived
           -- record is excluded by the archive check below.
           AND (o.closes_on IS NULL OR o.closes_on >= current_date)
           AND (o.archives_on IS NULL OR o.archives_on >= current_date)

           -- Eligibility is a hard gate, not a score contribution. Code 99 is
           -- unrestricted and 25 is "see the text field" -- neither can be
           -- ruled out from codes alone, so both stay in and are scored lower
           -- for imprecision rather than dropped.
           AND (
                cardinality(_p.eligibility_codes) = 0
                OR o.eligibility_codes && _p.eligibility_codes
                OR o.eligibility_codes && ARRAY['99', '25']
                OR cardinality(o.eligibility_codes) = 0
           )

           -- An organisation that cannot put up matching funds cannot deliver
           -- the grant, however well it fits.
           AND (
                _p.can_cost_share IS NOT FALSE
                OR o.cost_sharing_required IS NOT TRUE
           )

           -- Geography is derived rather than fed (the Grants.gov extract has
           -- no geographic fields at all), so national is the default and a
           -- state restriction only applies where enrichment has set one.
           AND (
                o.is_national
                OR cardinality(o.eligible_states) = 0
                OR o.eligible_states && (
                    CASE
                        WHEN _p.home_state IS NULL THEN _p.operating_states
                        ELSE _p.operating_states || ARRAY[_p.home_state]
                    END
                )
           )
    ),
    scored AS (
        SELECT
            c.id,
            c.title,
            c.closes_on,
            c.award_floor,
            c.award_ceiling,
            c.eligibility_codes,

            -- Subject fit, 0-40. ts_rank with normalisation 32 divides the
            -- raw rank by itself plus one, bounding it to [0,1) regardless of
            -- document length; without a normalisation flag the raw value is
            -- unbounded and a long description would outrank a precise title.
            --
            -- ts_rank saturates low -- even a good match rarely clears 0.25 --
            -- so the 4x spreads the useful band across the full 40 points.
            -- The least() is load-bearing, not decorative: without it the term
            -- reaches 160 and blows past its own stated maximum. A strong
            -- match simply earns full marks; it cannot earn more.
            CASE
                WHEN _q IS NULL THEN 0
                ELSE least(40, round(
                    40 * ts_rank(
                        setweight(to_tsvector('english', coalesce(c.title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(c.description, '')), 'B'),
                        _q,
                        32
                    )::numeric * 4
                ))
            END AS subject_points,

            -- Award fit, 0-25. Full marks when the ranges overlap, partial
            -- when the opportunity is silent about amounts (81% publish a
            -- ceiling, so silence is common and not disqualifying), zero when
            -- they demonstrably do not overlap.
            CASE
                WHEN _p.award_min IS NULL AND _p.award_max IS NULL THEN 12
                WHEN c.award_floor IS NULL AND c.award_ceiling IS NULL THEN 12
                WHEN coalesce(_p.award_min, 0) <= coalesce(c.award_ceiling, 1e15)
                 AND coalesce(_p.award_max, 1e15) >= coalesce(c.award_floor, 0) THEN 25
                ELSE 0
            END AS award_points,

            -- Deadline runway, 0-20. A grant closing in four days is not a
            -- real opportunity for most organisations, so a near deadline
            -- scores low rather than being hidden -- the user may still want
            -- to see it.
            CASE
                WHEN c.closes_on IS NULL THEN 16          -- rolling: always open
                WHEN c.closes_on - current_date >= 45 THEN 20
                WHEN c.closes_on - current_date >= 21 THEN 16
                WHEN c.closes_on - current_date >= 10 THEN 10
                WHEN c.closes_on - current_date >= 3  THEN 4
                ELSE 1
            END AS deadline_points,

            -- Eligibility precision, 0-15. Named explicitly beats being swept
            -- up in "unrestricted", which in turn beats an opportunity whose
            -- real rules are buried in prose we have not yet read.
            CASE
                WHEN o_named.matched THEN 15
                WHEN c.eligibility_codes && ARRAY['99'] THEN 10
                WHEN c.eligibility_codes && ARRAY['25'] THEN 6
                ELSE 8
            END AS eligibility_points,

            o_named.matched AS named_explicitly,
            (c.closes_on - current_date) AS days_left
        FROM candidates c
        CROSS JOIN LATERAL (
            SELECT c.eligibility_codes && _p.eligibility_codes AS matched
        ) AS o_named
    )
    SELECT
        s.id,
        -- Deliberately NOT wrapped in least(100, ...). Every component is
        -- bounded at source, so the total cannot exceed 100. A cap there would
        -- only hide a component that had broken its own limit -- which is
        -- precisely the bug the clamp above was added to fix, and which the
        -- cap concealed until a test checked the components individually.
        --
        -- The one adjustment made here is a ceiling, not a cap. The other
        -- three components are all satisfiable by an opportunity that has
        -- nothing to do with the organisation's work: any open grant with an
        -- unstated award size and a distant deadline collects roughly 47
        -- points before anyone asks what it funds. Measured against the real
        -- catalogue, 336 of 849 matches had zero subject overlap and still
        -- landed mid-table. A marine geology grant reading "52/100" to a youth
        -- education charity is not a useful number.
        --
        -- So when the organisation has told us what it does and the text shows
        -- no overlap at all, the total is held below the band we would ever
        -- recommend reading. The row stays visible and searchable -- lexical
        -- matching misses real synonyms, "out-of-school time" against "after
        -- school" being the obvious one -- but it can never masquerade as a
        -- decent fit. Closing that vocabulary gap is inference work, and
        -- belongs to the enrichment job, not here.
        CASE
            WHEN _q IS NOT NULL AND s.subject_points = 0
                THEN least(35, s.award_points + s.deadline_points + s.eligibility_points)
            ELSE s.subject_points + s.award_points + s.deadline_points + s.eligibility_points
        END::integer,
        -- Reasons are persisted with the score. A number without an
        -- explanation is not actionable, and support cannot defend it.
        jsonb_build_array(
            jsonb_build_object(
                'factor', 'subject_fit', 'points', s.subject_points, 'max', 40,
                'detail', CASE
                    WHEN _q IS NULL THEN 'No focus areas set on the profile'
                    WHEN s.subject_points >= 25 THEN 'Strongly matches your stated focus areas'
                    WHEN s.subject_points >= 10 THEN 'Partially matches your focus areas'
                    WHEN s.subject_points > 0 THEN 'Little overlap with your focus areas'
                    ELSE 'No wording in common with your focus areas, so the overall score is held down'
                END
            ),
            jsonb_build_object(
                'factor', 'award_fit', 'points', s.award_points, 'max', 25,
                'detail', CASE
                    WHEN s.award_points = 25 THEN 'Award size is within the range you can absorb'
                    WHEN s.award_points = 12 THEN 'Award size not stated'
                    ELSE 'Award size falls outside your stated range'
                END
            ),
            jsonb_build_object(
                'factor', 'deadline', 'points', s.deadline_points, 'max', 20,
                'detail', CASE
                    WHEN s.days_left IS NULL THEN 'Rolling deadline; applications accepted continuously'
                    WHEN s.days_left < 0 THEN 'Closed'
                    ELSE s.days_left || ' days until the deadline'
                END
            ),
            jsonb_build_object(
                'factor', 'eligibility', 'points', s.eligibility_points, 'max', 15,
                'detail', CASE
                    WHEN s.named_explicitly THEN 'Your organisation type is named as eligible'
                    WHEN s.eligibility_codes && ARRAY['99'] THEN 'Open to all applicant types'
                    WHEN s.eligibility_codes && ARRAY['25'] THEN 'Eligibility is described in prose; check the notice'
                    ELSE 'No applicant-type restriction published'
                END
            )
        )
    FROM scored s
    ORDER BY 2 DESC, s.days_left NULLS LAST, s.id
    LIMIT _limit;
END;
$$;


-- ---------------------------------------------------------------------------
-- Persist matches for a tenant
-- ---------------------------------------------------------------------------
-- Upsert rather than delete-and-insert, so first_seen_at survives a rescore.
-- "New since you last looked" is only answerable if the first sighting is
-- preserved, and a user-dismissed match must not resurface tomorrow.
CREATE OR REPLACE FUNCTION platform.refresh_matches_for_tenant(
    _tenant_id uuid,
    _limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    _count integer;
BEGIN
    WITH fresh AS (
        SELECT * FROM platform.score_opportunities_for_tenant(_tenant_id, _limit)
    ),
    upserted AS (
        INSERT INTO platform.opportunity_matches
            (tenant_id, opportunity_id, score, reasons, scorer_version, scored_at)
        SELECT _tenant_id, f.opportunity_id, f.score, f.reasons, platform.scorer_version(), now()
          FROM fresh f
        ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET
            score = EXCLUDED.score,
            reasons = EXCLUDED.reasons,
            scorer_version = EXCLUDED.scorer_version,
            scored_at = now()
            -- first_seen_at, saved_at and dismissed_at are deliberately not
            -- touched: they are the user's, not the scorer's.
        RETURNING 1
    )
    SELECT count(*) INTO _count FROM upserted;

    RETURN _count;
END;
$$;
