-- 0012: make the job ledger module-aware.
--
-- Zeus sells each service separately. A tenant can hold a Contract Compliance
-- subscription and no Grant Intelligence subscription at all. That commercial
-- fact has an operational consequence the original ledger did not honour:
-- one undifferentiated queue means a 500-record grant enrichment batch sits
-- in front of a contract analysis belonging to a customer who never bought
-- Grant Intelligence. They would be paying for a service degraded by one they
-- do not own.
--
-- Adding module_id fixes three things at once:
--
--   1. Isolation. Each service drains only its own module, so a failure or a
--      backlog in one cannot stall another. This is the property that makes
--      the services independently sellable rather than merely separately
--      priced.
--   2. Attribution. AI spend and job volume become answerable per module, so
--      unit economics per service are visible instead of pooled.
--   3. Fair scheduling. Per-module cadence becomes a product decision — grant
--      scans hourly, contract analysis within a minute — rather than a single
--      global queue order.
--
-- The column is NOT NULL with a foreign key: an unattributable job is a bug,
-- and the database should refuse to store one rather than let it surface
-- later as a gap in a billing report.

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
-- Added nullable first so the backfill can run, then tightened. Doing it in
-- one step would fail against any existing row.
ALTER TABLE platform.jobs
    ADD COLUMN IF NOT EXISTS module_id text REFERENCES platform.modules (id);

-- Backfill from the kind namespace. Every kind in use is prefixed by the
-- subsystem that owns it, so this is a lookup rather than a guess. Listed
-- explicitly instead of pattern-matched: a kind nobody anticipated should
-- stop the migration and be classified deliberately, not be silently filed
-- under whichever module a wildcard happened to reach first.
UPDATE platform.jobs
   SET module_id = CASE
        WHEN kind LIKE 'grants_gov.%'  THEN 'grant_intelligence'
        WHEN kind LIKE 'matching.%'    THEN 'grant_intelligence'
        WHEN kind LIKE 'enrichment.%'  THEN 'grant_intelligence'
        WHEN kind LIKE 'contract.%'    THEN 'contract_compliance'
        WHEN kind LIKE 'audit.%'       THEN 'audit_compliance'
       END
 WHERE module_id IS NULL;

-- Anything the backfill could not classify is a genuine unknown. Fail loudly
-- here rather than accept a NULL that the NOT NULL below would reject with a
-- far less informative message.
DO $$
DECLARE
    _orphans text;
BEGIN
    SELECT string_agg(DISTINCT kind, ', ') INTO _orphans
      FROM platform.jobs
     WHERE module_id IS NULL;

    IF _orphans IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot assign a module to job kinds: %. Add them to the backfill in 0012.',
            _orphans;
    END IF;
END;
$$;

ALTER TABLE platform.jobs
    ALTER COLUMN module_id SET NOT NULL;


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- The claim query now filters by module, so module_id leads the index. The
-- old index stays valid for nothing and is replaced rather than kept: two
-- overlapping partial indexes on a hot write path cost insert throughput for
-- no read benefit.
DROP INDEX IF EXISTS platform.jobs_claimable_idx;

CREATE INDEX IF NOT EXISTS jobs_claimable_idx
    ON platform.jobs (module_id, priority, run_after, created_at)
    WHERE status = 'queued';

-- Per-module queue depth, used by the console and by alerting.
CREATE INDEX IF NOT EXISTS jobs_module_recent_idx
    ON platform.jobs (module_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- Claim a job, within one module
-- ---------------------------------------------------------------------------
-- Replaces the 0009 signature. _module_id is required and has no default:
-- a caller that forgets it would otherwise silently drain every module,
-- which is precisely the isolation failure this migration exists to prevent.
--
-- The lease-recovery sweep at the top deliberately remains global. A crashed
-- worker's jobs must be recovered regardless of which module happens to be
-- polling, otherwise a module with no active worker would strand its own
-- expired leases indefinitely.
DROP FUNCTION IF EXISTS platform.claim_job(text, integer, text[]);

CREATE OR REPLACE FUNCTION platform.claim_job(
    _worker_id text,
    _module_id text,
    _lease_seconds integer DEFAULT 300,
    _kinds text[] DEFAULT NULL
)
RETURNS platform.jobs
LANGUAGE plpgsql
AS $$
DECLARE
    _job platform.jobs;
BEGIN
    -- Recover jobs whose worker died. Global by design: see the note above.
    UPDATE platform.jobs
       SET status = CASE
                        WHEN attempts >= max_attempts THEN 'failed'
                        ELSE 'queued'
                    END,
           locked_by = NULL,
           locked_until = NULL,
           last_error = COALESCE(last_error, 'worker lease expired'),
           finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
     WHERE status = 'running'
       AND locked_until < now();

    SELECT * INTO _job
      FROM platform.jobs
     WHERE status = 'queued'
       AND module_id = _module_id
       AND run_after <= now()
       AND (_kinds IS NULL OR kind = ANY (_kinds))
     ORDER BY priority, run_after, created_at
     LIMIT 1
       FOR UPDATE SKIP LOCKED;

    IF _job.id IS NULL THEN
        RETURN NULL;
    END IF;

    UPDATE platform.jobs
       SET status = 'running',
           attempts = attempts + 1,
           locked_by = _worker_id,
           locked_until = now() + make_interval(secs => _lease_seconds),
           started_at = COALESCE(started_at, now()),
           last_error = NULL
     WHERE id = _job.id
    RETURNING * INTO _job;

    RETURN _job;
END;
$$;
