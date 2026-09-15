-- 0008: funding opportunities, organisation profiles, and tenant-scoped matches.
--
-- This is the storage layer for grant discovery. It replaces a legacy design
-- that had no discovery at all: 22 hand-written rows, scored in the browser,
-- behind a "scan" button that ran SELECT count(*) and reported the total as
-- the number of new matches.
--
-- Three tables, each answering a different question:
--
--   opportunities      what exists in the world      (global, shared, no tenant)
--   org_profiles       who this tenant is            (one per tenant)
--   opportunity_matches  what fits them, and why     (tenant-scoped)
--
-- Opportunities are deliberately NOT tenant-scoped. A federal grant is a
-- public fact; copying 82,000 rows per tenant would multiply storage by the
-- customer count and make a daily refresh quadratic. What is private is the
-- match: the score, the reasons, and the fact that a given tenant was shown
-- a given opportunity.
--
-- Every number below was measured against the real Grants.gov extract for
-- 2026-09-14 (306 MB unzipped, 83,394 records), not taken from documentation.


-- ---------------------------------------------------------------------------
-- Reference: eligibility codes
-- ---------------------------------------------------------------------------
-- Grants.gov encodes eligibility as 17 fixed codes, not free text. The legacy
-- app used free-text arrays and had a latent bug because of it: one migration
-- seeded 'nonprofit' and another 'Nonprofit', and populations 'low-income'
-- against 'Low-income families'. Those were compared with exact equality, so
-- they silently never matched. Codes make that class of bug impossible.
--
-- Stored as a table rather than an enum so the descriptions can be shown in
-- the UI and a new code can be added without an ALTER TYPE.
CREATE TABLE IF NOT EXISTS platform.eligibility_codes (
    code          text PRIMARY KEY,
    description   text NOT NULL,
    -- Coarse grouping so a profile can say "we are a nonprofit" without
    -- enumerating the four nonprofit codes.
    applicant_class text NOT NULL
);

INSERT INTO platform.eligibility_codes (code, description, applicant_class) VALUES
    ('00', 'State governments', 'government'),
    ('01', 'County governments', 'government'),
    ('02', 'City or township governments', 'government'),
    ('04', 'Special district governments', 'government'),
    ('05', 'Independent school districts', 'education'),
    ('06', 'Public and State controlled institutions of higher education', 'education'),
    ('07', 'Native American tribal governments (Federally recognized)', 'tribal'),
    ('08', 'Public housing authorities / Indian housing authorities', 'government'),
    ('11', 'Native American tribal organizations (other than Federally recognized)', 'tribal'),
    ('12', 'Nonprofits having a 501(c)(3) status, other than institutions of higher education', 'nonprofit'),
    ('13', 'Nonprofits without 501(c)(3) status, other than institutions of higher education', 'nonprofit'),
    ('20', 'Private institutions of higher education', 'education'),
    ('21', 'Individuals', 'individual'),
    ('22', 'For-profit organizations other than small businesses', 'for_profit'),
    ('23', 'Small businesses', 'for_profit'),
    ('25', 'Others (see text field entitled "Additional Information on Eligibility")', 'other'),
    ('99', 'Unrestricted', 'unrestricted')
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Opportunities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.opportunities (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Provenance. Every row must be traceable to a source and a fetch, so a
    -- wrong record can be explained rather than guessed at. The legacy table
    -- had a source_id that was never populated by any code.
    source                 text NOT NULL,
    -- Stable identifier within that source. Grants.gov reuses OpportunityID
    -- across revisions and ships the same opportunity many times, so this is
    -- what makes the daily load idempotent.
    source_uid             text NOT NULL,
    source_url             text,
    -- When our pipeline last saw this record in a feed. Distinct from
    -- last_updated_at, which is the funder's own revision date.
    last_seen_at           timestamptz NOT NULL DEFAULT now(),

    title                  text NOT NULL,
    description            text,
    agency_name            text,
    agency_code            text,
    -- The funder's opportunity number as printed on the announcement. Users
    -- search by this, and it is what they quote to a programme officer.
    opportunity_number     text,

    -- Forecasts are announcements of grants that do not exist yet. They carry
    -- estimated dates and often no award amounts. Mixing them with live
    -- opportunities would show users deadlines they cannot apply to, so they
    -- are flagged and surfaced separately.
    is_forecast            boolean NOT NULL DEFAULT false,

    posted_on              date,
    -- Nullable on purpose: 4,480 of 83,394 records have no close date. Some
    -- are genuinely rolling, others are archived. A sentinel date would make
    -- "rolling" and "closed long ago" indistinguishable.
    closes_on              date,
    -- Grants.gov ships a free-text explanation for unusual deadlines
    -- ("applications accepted on a continuous basis"). Worth keeping: it is
    -- the only way to tell a rolling deadline from a missing one.
    close_note             text,
    archives_on            date,

    award_floor            numeric(14, 2),
    award_ceiling          numeric(14, 2),
    total_program_funding  numeric(16, 2),
    expected_award_count   integer,
    cost_sharing_required  boolean,

    -- Codes, not prose. Checked against the reference table on write.
    eligibility_codes      text[] NOT NULL DEFAULT '{}',
    -- Grants.gov's own category and instrument codes, kept raw so a later
    -- mapping change does not require a re-fetch of 306 MB.
    category_codes         text[] NOT NULL DEFAULT '{}',
    funding_instruments    text[] NOT NULL DEFAULT '{}',
    cfda_numbers           text[] NOT NULL DEFAULT '{}',
    -- The free-text eligibility narrative. Grants.gov code 25 ("Others, see
    -- text field") appears on 49,223 records -- the single most common code --
    -- so for well over half the catalogue this prose is the only real
    -- statement of who may apply. It cannot be discarded.
    eligibility_note       text,

    -- Geography is NOT a feed field. Verified: zero geographic elements exist
    -- anywhere in the 306 MB extract. Federal grants are national unless the
    -- eligibility prose says otherwise. These columns are therefore derived by
    -- our own enrichment, and default to national so an un-enriched row is
    -- treated as open to everyone rather than invisible.
    is_national            boolean NOT NULL DEFAULT true,
    eligible_states        text[] NOT NULL DEFAULT '{}',

    raw                    jsonb,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    -- One row per opportunity per source. This is what the daily load upserts
    -- on, and what stops a re-run creating 83,394 duplicates.
    CONSTRAINT opportunities_source_uid_key UNIQUE (source, source_uid),
    -- A closing date before the posting date means the parse went wrong.
    CONSTRAINT opportunities_dates_sane CHECK (closes_on IS NULL OR posted_on IS NULL OR closes_on >= posted_on),
    CONSTRAINT opportunities_award_range CHECK (
        award_floor IS NULL OR award_ceiling IS NULL OR award_ceiling >= award_floor
    )
);

-- The working set is tiny compared to the archive: 895 of 83,394 records are
-- open today. A partial index keeps the common query reading roughly 1% of the
-- table. The legacy table had no indexes at all and seq-scanned every match.
CREATE INDEX IF NOT EXISTS opportunities_open_idx
    ON platform.opportunities (closes_on)
    WHERE closes_on IS NOT NULL AND NOT is_forecast;

-- Rolling opportunities never appear in a date-bounded scan, so they need
-- their own path or they would be permanently invisible.
CREATE INDEX IF NOT EXISTS opportunities_rolling_idx
    ON platform.opportunities (posted_on DESC)
    WHERE closes_on IS NULL AND NOT is_forecast;

-- GIN for the array overlap operator (&&) used by eligibility filtering.
CREATE INDEX IF NOT EXISTS opportunities_eligibility_idx
    ON platform.opportunities USING gin (eligibility_codes);
CREATE INDEX IF NOT EXISTS opportunities_states_idx
    ON platform.opportunities USING gin (eligible_states);

-- Full-text over title and description for keyword search. Weighted so a
-- title hit outranks a body mention.
CREATE INDEX IF NOT EXISTS opportunities_fts_idx
    ON platform.opportunities USING gin (
        (setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
         setweight(to_tsvector('english', coalesce(description, '')), 'B'))
    );

CREATE INDEX IF NOT EXISTS opportunities_last_seen_idx
    ON platform.opportunities (source, last_seen_at DESC);


-- ---------------------------------------------------------------------------
-- Organisation profiles
-- ---------------------------------------------------------------------------
-- One per tenant. This is the input to matching, so every column here must
-- earn its place by being read by the scorer. The legacy profile carried 20+
-- columns that no matching code ever touched.
CREATE TABLE IF NOT EXISTS platform.org_profiles (
    tenant_id              uuid PRIMARY KEY REFERENCES platform.tenants (id) ON DELETE CASCADE,

    legal_name             text,
    ein                    text,
    -- Maps to eligibility_codes.applicant_class. This is the hard filter:
    -- a for-profit cannot win a 501(c)(3)-only grant no matter how well the
    -- subject matter fits, so it eliminates rather than scores.
    applicant_class        text,
    -- The specific codes this organisation can claim. A 501(c)(3) is '12';
    -- a small business is '23'. Held explicitly rather than derived, because
    -- some organisations legitimately hold several.
    eligibility_codes      text[] NOT NULL DEFAULT '{}',

    -- Two-letter USPS codes. home_state is where they are; operating_states is
    -- where they work, which is what actually governs eligibility.
    home_state             text,
    operating_states       text[] NOT NULL DEFAULT '{}',

    mission                text,
    focus_areas            text[] NOT NULL DEFAULT '{}',
    populations_served     text[] NOT NULL DEFAULT '{}',

    -- The award range they can absorb. A £2M grant is not a win for an
    -- organisation that cannot match or administer it.
    award_min              numeric(14, 2),
    award_max              numeric(14, 2),
    annual_budget          numeric(16, 2),
    -- Many federal grants require the applicant to fund part of the project.
    -- An organisation that cannot cost-share should not be shown them.
    can_cost_share         boolean,

    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT org_profiles_award_range CHECK (
        award_min IS NULL OR award_max IS NULL OR award_max >= award_min
    ),
    CONSTRAINT org_profiles_home_state_shape CHECK (
        home_state IS NULL OR home_state ~ '^[A-Z]{2}$'
    )
);


-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------
-- The tenant-private half. Scores are persisted rather than recomputed per
-- page load so that "new since last week" is answerable, and so the score a
-- user saw is the score we can explain later.
CREATE TABLE IF NOT EXISTS platform.opportunity_matches (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES platform.tenants (id) ON DELETE CASCADE,
    opportunity_id    uuid NOT NULL REFERENCES platform.opportunities (id) ON DELETE CASCADE,

    score             integer NOT NULL,
    -- Why it scored what it scored, component by component. Persisted because
    -- a score without a reason is not actionable, and because the rules will
    -- change -- an old match should still explain itself under the rules that
    -- produced it.
    reasons           jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- The rule set version that produced this row, so a scoring change can be
    -- rolled out without silently rewriting history.
    scorer_version    integer NOT NULL,

    -- User actions. Dismissed matches stay so the same opportunity is not
    -- resurfaced every run.
    saved_at          timestamptz,
    dismissed_at      timestamptz,

    first_seen_at     timestamptz NOT NULL DEFAULT now(),
    scored_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT opportunity_matches_unique UNIQUE (tenant_id, opportunity_id),
    CONSTRAINT opportunity_matches_score_range CHECK (score BETWEEN 0 AND 100)
);

-- The main read: this tenant's best open matches.
CREATE INDEX IF NOT EXISTS opportunity_matches_ranked_idx
    ON platform.opportunity_matches (tenant_id, score DESC, first_seen_at DESC)
    WHERE dismissed_at IS NULL;

CREATE INDEX IF NOT EXISTS opportunity_matches_saved_idx
    ON platform.opportunity_matches (tenant_id, saved_at DESC)
    WHERE saved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS opportunity_matches_opportunity_idx
    ON platform.opportunity_matches (opportunity_id);
