-- 0011: enrichment cache, and the corrected scoring functions.
--
-- Two things in one file because they ship together: the enrichment cache is
-- new, and the scoring functions from 0010 are redefined here because 0010 is
-- already recorded as applied and a migration ledger must never be rewritten
-- to make a fix land. Editing an applied migration means a fresh database and
-- an existing one diverge permanently, and nothing warns you.


-- ---------------------------------------------------------------------------
-- Enrichment cache
-- ---------------------------------------------------------------------------
-- Model output is expensive and deterministic inputs deserve deterministic
-- cost. One agency reuses the same eligibility paragraph across hundreds of
-- notices, so the cache key is a hash of the text itself rather than the
-- opportunity id -- otherwise the same paragraph is paid for hundreds of times.
CREATE TABLE IF NOT EXISTS platform.enrichment_cache (
    input_hash      text NOT NULL,

    -- Bumped when the prompt or the output schema changes. Without it, a
    -- prompt fix would apply only to records enriched afterwards, leaving a
    -- silent mix of old and new interpretations with no way to tell them apart.
    version         integer NOT NULL,

    payload         jsonb NOT NULL,

    -- Which opportunity prompted the first read. Informational only: the cache
    -- is keyed by text, and the same entry serves every notice sharing it.
    -- ON DELETE SET NULL because losing the opportunity must not evict a still
    -- valid reading of text that other notices also use.
    opportunity_id  uuid REFERENCES platform.opportunities (id) ON DELETE SET NULL,

    -- Recorded so a bad batch can be traced to the model that produced it.
    model           text,

    created_at      timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (input_hash, version)
);

CREATE INDEX IF NOT EXISTS enrichment_cache_opportunity_idx
    ON platform.enrichment_cache (opportunity_id)
    WHERE opportunity_id IS NOT NULL;

-- Supports eviction by age without scanning the table.
CREATE INDEX IF NOT EXISTS enrichment_cache_created_idx
    ON platform.enrichment_cache (created_at);


-- ---------------------------------------------------------------------------
-- Enriched eligibility on opportunities
-- ---------------------------------------------------------------------------
-- Kept in separate columns from the source data. Merging model output into
-- eligibility_codes would make the two indistinguishable, and a wrong code
-- there tells someone they can apply for something they cannot. The scorer
-- reads the source columns; these are for display and for widening a search,
-- and they are labelled as inferred wherever they surface.
ALTER TABLE platform.opportunities
    ADD COLUMN IF NOT EXISTS inferred_codes      text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS inferred_states     text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS inferred_summary    text,
    ADD COLUMN IF NOT EXISTS inferred_confidence real,
    ADD COLUMN IF NOT EXISTS enriched_at         timestamptz,
    ADD COLUMN IF NOT EXISTS enrichment_version  integer;

-- Finds the enrichment backlog cheaply. Partial, because the whole point is to
-- locate the small set of rows still needing work inside a table of 83,394.
CREATE INDEX IF NOT EXISTS opportunities_needs_enrichment_idx
    ON platform.opportunities (closes_on)
    WHERE enriched_at IS NULL
      AND eligibility_note IS NOT NULL
      AND NOT is_forecast;


-- ---------------------------------------------------------------------------
-- Corrected scoring functions
-- ---------------------------------------------------------------------------
-- Two defects found by testing 0010 against the real catalogue:
--
--   1. The subject-fit term multiplied a normalised rank by 4 to spread the
--      useful band, which let a 40-point component reach 160. The total was
--      wrapped in least(100, ...), so the overflow was invisible in the score
--      and only showed up when a test checked each component against its own
--      stated maximum. The clamp now sits on the component, and the cap on the
--      total is gone -- it could only ever hide this class of bug.
--
--   2. Award fit, deadline and eligibility are all satisfiable by an
--      opportunity with nothing to do with the organisation's work, flooring
--      an irrelevant grant near 47. Measured on the real data, 336 of 849
--      matches had zero subject overlap and still landed mid-table. Those are
--      now held below 35: visible and searchable, never recommended.

CREATE OR REPLACE FUNCTION platform.scorer_version() RETURNS integer
LANGUAGE sql IMMUTABLE AS $$ SELECT 2 $$;


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
           AND (o.closes_on IS NULL OR o.closes_on >= current_date)
           AND (o.archives_on IS NULL OR o.archives_on >= current_date)
           AND (
                cardinality(_p.eligibility_codes) = 0
                OR o.eligibility_codes && _p.eligibility_codes
                OR o.eligibility_codes && ARRAY['99', '25']
                OR cardinality(o.eligibility_codes) = 0
           )
           AND (
                _p.can_cost_share IS NOT FALSE
                OR o.cost_sharing_required IS NOT TRUE
           )
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
            c.closes_on,
            c.eligibility_codes,

            -- Subject fit, 0-40. ts_rank with normalisation 32 bounds the raw
            -- rank to [0,1); the 4x spreads the band it actually occupies,
            -- since ts_rank clusters low. least() is what keeps that spreading
            -- from breaching the stated maximum.
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

            CASE
                WHEN _p.award_min IS NULL AND _p.award_max IS NULL THEN 12
                WHEN c.award_floor IS NULL AND c.award_ceiling IS NULL THEN 12
                WHEN coalesce(_p.award_min, 0) <= coalesce(c.award_ceiling, 1e15)
                 AND coalesce(_p.award_max, 1e15) >= coalesce(c.award_floor, 0) THEN 25
                ELSE 0
            END AS award_points,

            CASE
                WHEN c.closes_on IS NULL THEN 16
                WHEN c.closes_on - current_date >= 45 THEN 20
                WHEN c.closes_on - current_date >= 21 THEN 16
                WHEN c.closes_on - current_date >= 10 THEN 10
                WHEN c.closes_on - current_date >= 3  THEN 4
                ELSE 1
            END AS deadline_points,

            CASE
                WHEN c.eligibility_codes && _p.eligibility_codes THEN 15
                WHEN c.eligibility_codes && ARRAY['99'] THEN 10
                WHEN c.eligibility_codes && ARRAY['25'] THEN 6
                ELSE 8
            END AS eligibility_points,

            (c.eligibility_codes && _p.eligibility_codes) AS named_explicitly,
            (c.closes_on - current_date) AS days_left
        FROM candidates c
    )
    SELECT
        s.id,
        CASE
            WHEN _q IS NOT NULL AND s.subject_points = 0
                THEN least(35, s.award_points + s.deadline_points + s.eligibility_points)
            ELSE s.subject_points + s.award_points + s.deadline_points + s.eligibility_points
        END::integer,
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
