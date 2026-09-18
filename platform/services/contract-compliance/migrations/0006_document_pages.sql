-- ---------------------------------------------------------------------------
-- 0006: Billable page counts on documents.
--
-- DEC-11 defines what a page is; this is where the number is kept so it can
-- be billed against. Two columns:
--
--   pages       — the billable count for this document, never below 1.
--   page_basis  — 'counted' when the format told us (a PDF stores its pages,
--                 a DOCX records authored breaks) or 'estimated' when it was
--                 derived from length. Kept so an invoice line can be
--                 explained to a customer rather than merely asserted; a
--                 support question about a bill is answerable from the row.
--
-- Backfill: existing rows predate the rule, so their real page count is
-- unknowable — the bytes are in object storage but re-parsing every document
-- inside a migration is not something to do while holding a lock. They are
-- given the character estimate, which is exactly what the rule prescribes for
-- a document whose format cannot tell us, and marked 'estimated' so they are
-- not mistaken later for counts that came from a parser.
--
-- ceil(extracted_chars / 3000) must stay in step with CHARS_PER_PAGE in
-- documents.py. A test asserts the two agree, because a silent divergence
-- would mean old rows and new rows are billed on different scales.
-- ---------------------------------------------------------------------------

ALTER TABLE contract_compliance.documents
    ADD COLUMN IF NOT EXISTS pages integer,
    ADD COLUMN IF NOT EXISTS page_basis text;

UPDATE contract_compliance.documents
   SET pages = GREATEST(1, CEIL(extracted_chars::numeric / 3000)::integer),
       page_basis = 'estimated'
 WHERE pages IS NULL;

-- Applied after the backfill so the NOT NULL can be taken without a second
-- pass, and so a bug in the backfill fails the migration rather than leaving
-- unbillable rows behind.
ALTER TABLE contract_compliance.documents
    ALTER COLUMN pages SET NOT NULL,
    ALTER COLUMN pages SET DEFAULT 1,
    ALTER COLUMN page_basis SET NOT NULL,
    ALTER COLUMN page_basis SET DEFAULT 'estimated';

-- A zero-page document cannot be billed and should not exist; the basis is
-- constrained because it is shown to customers and a typo'd value would be
-- displayed verbatim.
ALTER TABLE contract_compliance.documents
    DROP CONSTRAINT IF EXISTS cc_documents_pages_positive;
ALTER TABLE contract_compliance.documents
    ADD CONSTRAINT cc_documents_pages_positive CHECK (pages >= 1);

ALTER TABLE contract_compliance.documents
    DROP CONSTRAINT IF EXISTS cc_documents_page_basis_known;
ALTER TABLE contract_compliance.documents
    ADD CONSTRAINT cc_documents_page_basis_known
        CHECK (page_basis IN ('counted', 'estimated'));

-- Supports the monthly page total, which is read on the upload path. Ordered
-- (tenant_id, created_at) so the month is a range scan inside one tenant, and
-- INCLUDE (pages) so the sum is answered from the index without touching the
-- heap. This is a per-tenant, per-month slice of a table that grows one row
-- per upload -- unlike platform.ai_usage, which grows one row per LLM call
-- and must never be summed on a request path.
CREATE INDEX IF NOT EXISTS idx_cc_documents_tenant_month
    ON contract_compliance.documents(tenant_id, created_at)
    INCLUDE (pages);

-- idx_cc_documents_tenant(tenant_id) is now redundant: the index above leads
-- with the same column, so it answers everything the old one did and more.
-- Keeping both would cost a write on every upload and give the planner a
-- pointless choice -- which it was making, picking the narrower index and
-- turning what should be an index-only scan into a heap fetch.
DROP INDEX IF EXISTS contract_compliance.idx_cc_documents_tenant;
