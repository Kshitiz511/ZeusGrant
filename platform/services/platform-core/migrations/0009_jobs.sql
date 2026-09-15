-- 0009: durable job ledger.
--
-- Everything in grant discovery is too slow for a web request. Loading the
-- Grants.gov extract takes 28 seconds locally against 83,394 rows; scoring
-- every tenant against the catalogue is comparable. Vercel's function limit
-- is 60 seconds, so both must run outside the request path or they will fail
-- in production while passing on a laptop.
--
-- This is a ledger, not a queue. The queue (QStash in production, in-memory
-- locally) carries the wake-up signal; this table carries the truth. That
-- split matters because message queues offer at-least-once delivery: the same
-- job can be delivered twice, or a worker can die mid-run and the message
-- reappear. Without a durable record of what has actually been done, a
-- redelivery would re-run work that already succeeded.
--
-- The design goals, in order:
--   1. A crashed worker must not strand a job forever.  (leases expire)
--   2. A duplicate delivery must not do the work twice. (idempotency_key)
--   3. A permanently broken job must stop retrying.     (attempts + max_attempts)
--   4. An operator must be able to see why.             (last_error, timings)

CREATE TABLE IF NOT EXISTS platform.jobs (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What to run. A short string the worker maps to a handler, e.g.
    -- 'grants_gov.ingest' or 'matching.rescore_tenant'.
    kind              text NOT NULL,
    -- Handler arguments. Deliberately opaque to this table: the ledger tracks
    -- execution, not semantics.
    payload           jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Null for platform-wide work such as the nightly ingest. Set for
    -- tenant-scoped work so one tenant's backlog can be inspected, throttled
    -- or cancelled without touching another's.
    tenant_id         uuid REFERENCES platform.tenants (id) ON DELETE CASCADE,

    -- queued -> running -> succeeded | failed | cancelled
    status            text NOT NULL DEFAULT 'queued',

    -- Caller-supplied de-duplication key. Two enqueues with the same key
    -- collapse to one job. This is what makes "ingest today's extract" safe
    -- to call from a cron that fires twice, or from a retried HTTP request.
    idempotency_key   text,

    -- Lower runs first; ties broken by age. Interactive work (a user pressing
    -- "find matches") should not queue behind a nightly bulk load.
    priority          smallint NOT NULL DEFAULT 100,

    attempts          integer NOT NULL DEFAULT 0,
    max_attempts      integer NOT NULL DEFAULT 3,

    -- Earliest time this job may be claimed. Used for scheduling and for
    -- exponential backoff between retries.
    run_after         timestamptz NOT NULL DEFAULT now(),

    -- Lease. A worker claims a job by setting these; if it dies, the lease
    -- expires and another worker may claim it. Without an expiring lease a
    -- crash would leave the row 'running' forever and the job would never
    -- complete or retry.
    locked_by         text,
    locked_until      timestamptz,

    -- Progress for long jobs, so a stuck load is distinguishable from a slow
    -- one while it is still running.
    progress_total    integer,
    progress_done     integer,

    result            jsonb,
    last_error        text,

    created_at        timestamptz NOT NULL DEFAULT now(),
    started_at        timestamptz,
    finished_at       timestamptz,

    CONSTRAINT jobs_status_known CHECK (
        status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
    ),
    CONSTRAINT jobs_attempts_sane CHECK (attempts >= 0 AND max_attempts >= 1),
    -- A running job must hold a lease. This makes the "claimed but unlocked"
    -- state -- which would be invisible to both the worker and the reaper --
    -- impossible to represent.
    CONSTRAINT jobs_running_has_lease CHECK (
        status <> 'running' OR (locked_by IS NOT NULL AND locked_until IS NOT NULL)
    )
);

-- De-duplication. Partial so that only live work collides: once a job has
-- finished, the same key may be used again for tomorrow's run. A plain unique
-- index would let one successful ingest block every future ingest.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_live_idx
    ON platform.jobs (kind, idempotency_key)
    WHERE idempotency_key IS NOT NULL AND status IN ('queued', 'running');

-- The claim query: the oldest eligible job by priority. Partial, because
-- finished jobs accumulate indefinitely and must not be scanned.
CREATE INDEX IF NOT EXISTS jobs_claimable_idx
    ON platform.jobs (priority, run_after, created_at)
    WHERE status = 'queued';

-- The reaper query: running jobs whose lease has expired.
CREATE INDEX IF NOT EXISTS jobs_expired_lease_idx
    ON platform.jobs (locked_until)
    WHERE status = 'running';

CREATE INDEX IF NOT EXISTS jobs_tenant_recent_idx
    ON platform.jobs (tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Claim a job
-- ---------------------------------------------------------------------------
-- SKIP LOCKED is what allows several workers to pull from the same table
-- without blocking each other: a row already locked by another transaction is
-- passed over rather than waited on. Without it, N workers would serialise on
-- the single oldest row and throughput would not scale past one.
--
-- Written as a function rather than inline SQL so the locking rules live in
-- one place and cannot drift between callers.
CREATE OR REPLACE FUNCTION platform.claim_job(
    _worker_id text,
    _lease_seconds integer DEFAULT 300,
    _kinds text[] DEFAULT NULL
)
RETURNS platform.jobs
LANGUAGE plpgsql
AS $$
DECLARE
    _job platform.jobs;
BEGIN
    -- Recover jobs whose worker died. The lease has expired, so the row is
    -- returned to the queue rather than left running forever. This runs on
    -- every claim, which means no separate reaper process is needed.
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


-- ---------------------------------------------------------------------------
-- Finish a job
-- ---------------------------------------------------------------------------
-- Success and failure share a function so that releasing the lease can never
-- be forgotten on one path.
CREATE OR REPLACE FUNCTION platform.finish_job(
    _job_id uuid,
    _worker_id text,
    _succeeded boolean,
    _result jsonb DEFAULT NULL,
    _error text DEFAULT NULL,
    _retry_delay_seconds integer DEFAULT 60
)
RETURNS platform.jobs
LANGUAGE plpgsql
AS $$
DECLARE
    _job platform.jobs;
BEGIN
    -- The worker_id check stops a worker that lost its lease (because it
    -- stalled past the expiry and the job was reassigned) from overwriting
    -- the result of the worker that actually took over.
    SELECT * INTO _job
      FROM platform.jobs
     WHERE id = _job_id AND locked_by = _worker_id
       FOR UPDATE;

    IF _job.id IS NULL THEN
        RETURN NULL;
    END IF;

    IF _succeeded THEN
        UPDATE platform.jobs
           SET status = 'succeeded',
               result = _result,
               locked_by = NULL,
               locked_until = NULL,
               finished_at = now()
         WHERE id = _job_id
        RETURNING * INTO _job;
    ELSIF _job.attempts >= _job.max_attempts THEN
        UPDATE platform.jobs
           SET status = 'failed',
               last_error = _error,
               locked_by = NULL,
               locked_until = NULL,
               finished_at = now()
         WHERE id = _job_id
        RETURNING * INTO _job;
    ELSE
        -- Exponential backoff. A job failing because a source is down should
        -- not retry immediately and hammer it.
        UPDATE platform.jobs
           SET status = 'queued',
               last_error = _error,
               locked_by = NULL,
               locked_until = NULL,
               run_after = now() + make_interval(
                   secs => _retry_delay_seconds * power(2, _job.attempts - 1)::integer
               )
         WHERE id = _job_id
        RETURNING * INTO _job;
    END IF;

    RETURN _job;
END;
$$;


-- ---------------------------------------------------------------------------
-- Extend a lease
-- ---------------------------------------------------------------------------
-- A long job must prove it is alive. Without heartbeats the lease would have
-- to be set to the worst-case runtime, which would leave a genuinely crashed
-- job stranded for that whole period.
CREATE OR REPLACE FUNCTION platform.heartbeat_job(
    _job_id uuid,
    _worker_id text,
    _lease_seconds integer DEFAULT 300,
    _progress_done integer DEFAULT NULL,
    _progress_total integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
AS $$
    UPDATE platform.jobs
       SET locked_until = now() + make_interval(secs => _lease_seconds),
           progress_done = COALESCE(_progress_done, progress_done),
           progress_total = COALESCE(_progress_total, progress_total)
     WHERE id = _job_id
       AND locked_by = _worker_id
       AND status = 'running'
    RETURNING true;
$$;
