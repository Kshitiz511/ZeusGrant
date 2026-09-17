-- 0018: operator control over the job ledger — reap, cancel, retry.
--
-- The ledger has been write-only from an operator's point of view since 0009.
-- Jobs are enqueued, claimed, finished and retried entirely by machines. There
-- is no way to look at one, no way to stop one, and no way to give a failed one
-- another chance. This migration adds the three server-side primitives that an
-- admin API needs, plus a correctness fix to the retry backoff.
--
-- All three are SQL functions rather than statements issued from Python. The
-- Database protocol this codebase uses exposes fetch/fetch_one/execute and no
-- transaction handle, so anything needing read-then-write atomicity has to live
-- in one statement. That is the same reason claim_job and finish_job are
-- functions, and these have exactly the same requirement: each one decides what
-- to do based on the row's current state, and a concurrent worker must not be
-- able to change that state in between.

-- ---------------------------------------------------------------------------
-- 1. Reaper (defect D12)
-- ---------------------------------------------------------------------------
-- Expired-lease recovery already exists, but only as the first statement inside
-- claim_job. It therefore runs only when somebody asks for work. That is fine
-- while a worker is polling and useless in the situation it was written for: a
-- worker that died. If the only worker for a module is gone, or the deployment
-- is serverless and no wake-up arrives, nothing calls claim_job, nothing sweeps,
-- and the job stays 'running' forever behind a lease no process still holds.
-- jobs_expired_lease_idx has existed since 0009 and is commented "the reaper
-- query"; this is the reaper it was built for.
--
-- Extracted rather than duplicated. Two copies of recovery logic that drifted
-- apart would produce jobs recovered differently depending on which path found
-- them, which is the kind of inconsistency that is very hard to see in a ledger.
-- claim_job is redefined below to call this.
--
-- _max_rows bounds one sweep. A backlog of ten thousand expired leases must not
-- become a single unbounded UPDATE holding locks while the queue stalls behind
-- it; the sweep runs again on the next tick and drains the rest.
CREATE OR REPLACE FUNCTION platform.reap_expired_leases(
    _module_id text DEFAULT NULL,
    _max_rows integer DEFAULT 1000
)
RETURNS TABLE (id uuid, module_id text, kind text, attempts integer, outcome text)
LANGUAGE sql
AS $$
    WITH expired AS (
        SELECT j.id
          FROM platform.jobs j
         WHERE j.status = 'running'
           AND j.locked_until < now()
           AND (_module_id IS NULL OR j.module_id = _module_id)
         ORDER BY j.locked_until
         LIMIT _max_rows
         -- Skip rows a concurrent claim_job sweep is already recovering. Both
         -- paths are correct alone; blocking on each other would make the
         -- reaper's runtime depend on queue traffic.
         FOR UPDATE SKIP LOCKED
    )
    UPDATE platform.jobs j
       SET status = CASE WHEN j.attempts >= j.max_attempts THEN 'failed' ELSE 'queued' END,
           locked_by = NULL,
           locked_until = NULL,
           -- Record the cause without destroying a real handler error. A job
           -- that failed with a genuine exception and was then stranded should
           -- show both, in order: the original failure is what an operator
           -- needs, and 'worker lease expired' alone would send them looking
           -- for an infrastructure fault that is not there.
           last_error = CASE
               WHEN j.last_error IS NULL THEN 'worker lease expired'
               ELSE left(j.last_error, 3900) || E'\n[reaped: worker lease expired]'
           END,
           finished_at = CASE WHEN j.attempts >= j.max_attempts THEN now() ELSE NULL END
      FROM expired e
     WHERE j.id = e.id
    RETURNING j.id, j.module_id, j.kind, j.attempts,
              CASE WHEN j.status = 'failed' THEN 'exhausted' ELSE 'requeued' END;
$$;

COMMENT ON FUNCTION platform.reap_expired_leases(text, integer) IS
    'Recover jobs whose worker died holding the lease. Requeues if attempts '
    'remain, fails them if not. Safe to run concurrently with claim_job.';


-- ---------------------------------------------------------------------------
-- 2. claim_job now delegates its sweep
-- ---------------------------------------------------------------------------
-- Same behaviour as 0012, with the inline UPDATE replaced by a call. Kept in
-- claim_job as well as on a schedule because recovery on the path that is about
-- to pick up work is what makes a retry prompt: waiting for the next sweep tick
-- would add the reaper's interval to every recovered job's latency.
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
    -- Deliberately not filtered by module: a worker for one module recovering
    -- another's abandoned lease costs nothing and means a module whose workers
    -- are all dead is still repaired by traffic elsewhere.
    PERFORM platform.reap_expired_leases(NULL, 1000);

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
           started_at = COALESCE(started_at, now())
     WHERE id = _job.id
    RETURNING * INTO _job;

    RETURN _job;
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. Cancel (defect D10)
-- ---------------------------------------------------------------------------
-- 'cancelled' has been in the status CHECK since 0009 and nothing has ever
-- written it. This is the writer.
--
-- Cancelling a *running* job clears the lease, which is what makes the cancel
-- bite rather than merely relabel. heartbeat_job requires status = 'running',
-- so the running handler's next heartbeat is rejected, ctx.progress raises
-- JobLost, and the worker abandons the job without touching the ledger. For a
-- handler with a progress loop -- which is every expensive one, because that is
-- why they report progress -- the work stops at the next checkpoint. For one
-- without, the worker's own 90-second keepalive detects it. Either way the
-- outcome is bounded, and the cancelled row cannot be overwritten afterwards
-- because finish_job matches on locked_by, which is now NULL.
--
-- Terminal states are not cancellable. Cancelling something that already
-- succeeded would discard a real result and make the ledger lie about what
-- happened; the caller is told what the status actually is so the API can
-- answer honestly instead of reporting a no-op as success.
CREATE OR REPLACE FUNCTION platform.cancel_job(
    _job_id uuid,
    _reason text DEFAULT NULL
)
RETURNS platform.jobs
LANGUAGE plpgsql
AS $$
DECLARE
    _job platform.jobs;
BEGIN
    SELECT * INTO _job FROM platform.jobs WHERE id = _job_id FOR UPDATE;

    IF _job.id IS NULL THEN
        RETURN NULL;
    END IF;

    IF _job.status NOT IN ('queued', 'running') THEN
        -- Unchanged row back to the caller. The status it carries is how the
        -- API distinguishes "already finished" from "cancelled just now".
        RETURN _job;
    END IF;

    UPDATE platform.jobs
       SET status = 'cancelled',
           locked_by = NULL,
           locked_until = NULL,
           last_error = COALESCE(_reason, 'cancelled by operator'),
           finished_at = now()
     WHERE id = _job_id
    RETURNING * INTO _job;

    RETURN _job;
END;
$$;

COMMENT ON FUNCTION platform.cancel_job(uuid, text) IS
    'Cancel a queued or running job. Clearing the lease makes a running '
    'handler stop at its next heartbeat. Terminal jobs are returned unchanged.';


-- ---------------------------------------------------------------------------
-- 4. Retry (question Q6)
-- ---------------------------------------------------------------------------
-- Q6 asked whether an operator's retry resets attempts or continues the count.
-- It resets. An operator pressing retry is asserting that the cause has been
-- addressed -- the credential fixed, the upstream back up, the bug deployed.
-- Continuing the count would mean a job that had already used its three
-- attempts is retried once and immediately fails as exhausted, which from the
-- outside is indistinguishable from the button not working.
--
-- The count is not lost: attempts is copied into last_error's prefix so the
-- history stays visible, and admin_audit records who pressed it.
--
-- The sharp edge is the partial unique index on (kind, idempotency_key) over
-- live statuses. Requeueing a failed job whose key has since been taken by a
-- newer live job violates it. Postgres would raise 23505 and the API would
-- return 500 for what is really a conflict, so the collision is detected here
-- and reported as a distinguishable outcome instead.
CREATE OR REPLACE FUNCTION platform.retry_job(
    _job_id uuid,
    _run_after timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
    _job platform.jobs;
    _blocker uuid;
BEGIN
    SELECT * INTO _job FROM platform.jobs WHERE id = _job_id FOR UPDATE;

    IF _job.id IS NULL THEN
        RETURN 'not_found';
    END IF;

    -- Only terminal jobs. Retrying a running job would create a second worker
    -- for one unit of work, and retrying a queued one is a no-op dressed up as
    -- an action.
    IF _job.status NOT IN ('failed', 'cancelled') THEN
        RETURN 'not_retryable';
    END IF;

    IF _job.idempotency_key IS NOT NULL THEN
        SELECT j.id INTO _blocker
          FROM platform.jobs j
         WHERE j.kind = _job.kind
           AND j.idempotency_key = _job.idempotency_key
           AND j.status IN ('queued', 'running')
         LIMIT 1;

        IF _blocker IS NOT NULL THEN
            -- A live job is already doing exactly this work. Retrying would
            -- either violate the index or duplicate the effort.
            RETURN 'superseded';
        END IF;
    END IF;

    UPDATE platform.jobs
       SET status = 'queued',
           attempts = 0,
           locked_by = NULL,
           locked_until = NULL,
           result = NULL,
           started_at = NULL,
           finished_at = NULL,
           run_after = COALESCE(_run_after, now()),
           last_error = format('[retried by operator after %s attempt(s)] %s',
                               _job.attempts, COALESCE(left(_job.last_error, 3900), ''))
     WHERE id = _job_id;

    RETURN 'requeued';
END;
$$;

COMMENT ON FUNCTION platform.retry_job(uuid, timestamptz) IS
    'Requeue a failed or cancelled job with attempts reset to 0. Returns an '
    'outcome so the caller can distinguish requeued/not_retryable/superseded.';


-- ---------------------------------------------------------------------------
-- 5. Backoff was applied twice (defect D19)
-- ---------------------------------------------------------------------------
-- The worker computes exponential backoff -- min(60 * 2^(attempts-1), 3600) --
-- and passes the result as _retry_delay_seconds. finish_job then multiplied it
-- by power(2, attempts - 1) a second time. Attempt 2 waited 240s rather than
-- the 120s the worker intended, and the SQL side had no ceiling, so the error
-- compounded without bound as max_attempts rose.
--
-- At max_attempts = 3 the visible damage is small, which is why it survived.
-- It is fixed now because Phase 6 puts a "next retry at" time in front of an
-- operator, and a displayed time that is wrong by a growing multiple is worse
-- than no time at all.
--
-- The delay is now used as given. The caller owns the policy; this function
-- records the decision. A second multiplier here also made the delay depend on
-- who called it, so an operator-triggered retry would have been silently
-- rescaled by a number of attempts they had just reset.
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
    -- stalled past the expiry and the job was reassigned, or because an
    -- operator cancelled it) from overwriting the authoritative outcome.
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
        UPDATE platform.jobs
           SET status = 'queued',
               last_error = _error,
               locked_by = NULL,
               locked_until = NULL,
               run_after = now() + make_interval(secs => greatest(_retry_delay_seconds, 0))
         WHERE id = _job_id
        RETURNING * INTO _job;
    END IF;

    RETURN _job;
END;
$$;


-- ---------------------------------------------------------------------------
-- 6. Index for the admin list
-- ---------------------------------------------------------------------------
-- Every existing index leads with tenant_id or module_id because every existing
-- reader is scoped to one of them. The admin list is the first reader that is
-- scoped to neither: "show me everything that failed today, across all
-- modules". Without this it is a sequential scan of the whole ledger on the one
-- screen somebody opens when the platform is already in trouble.
CREATE INDEX IF NOT EXISTS jobs_status_recent_idx
    ON platform.jobs (status, created_at DESC);
