-- Exercise the job ledger's concurrency and failure rules.
-- Run with: docker exec -i <pg> psql -U zeus -d zeus -f this
\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- Clean slate inside the transaction; rolled back at the end.
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';

-- --- idempotency -----------------------------------------------------------
INSERT INTO platform.jobs (module_id, kind, idempotency_key) VALUES ('grant_intelligence', 'test.ingest', 'day-1');
INSERT INTO platform.jobs (module_id, kind, idempotency_key) VALUES ('grant_intelligence', 'test.ingest', 'day-1')
ON CONFLICT DO NOTHING;
SELECT 'idempotency: one row for a duplicate key' AS check,
       count(*) = 1 AS passed
  FROM platform.jobs WHERE kind = 'test.ingest';

-- --- claim -----------------------------------------------------------------
SELECT 'claim: worker A gets the job' AS check,
       (platform.claim_job('worker-A', 'grant_intelligence', 300, ARRAY['test.ingest'])).status = 'running' AS passed;

-- --- no double claim -------------------------------------------------------
SELECT 'claim: worker B gets nothing' AS check,
       (platform.claim_job('worker-B', 'grant_intelligence', 300, ARRAY['test.ingest'])) IS NULL AS passed;

-- --- heartbeat -------------------------------------------------------------
SELECT 'heartbeat: extends only for the lease holder' AS check,
       platform.heartbeat_job(
           (SELECT id FROM platform.jobs WHERE kind = 'test.ingest'),
           'worker-A', 600, 50, 100
       ) IS TRUE AS passed;

SELECT 'heartbeat: refused for a non-holder' AS check,
       platform.heartbeat_job(
           (SELECT id FROM platform.jobs WHERE kind = 'test.ingest'),
           'worker-B', 600
       ) IS NULL AS passed;

-- --- finish, wrong worker --------------------------------------------------
SELECT 'finish: a stale worker cannot overwrite the result' AS check,
       platform.finish_job(
           (SELECT id FROM platform.jobs WHERE kind = 'test.ingest'),
           'worker-B', true, '{}'::jsonb
       ) IS NULL AS passed;

-- --- finish, right worker --------------------------------------------------
SELECT 'finish: lease holder succeeds and releases the lock' AS check,
       (SELECT status = 'succeeded' AND locked_by IS NULL AND finished_at IS NOT NULL
          FROM platform.finish_job(
              (SELECT id FROM platform.jobs WHERE kind = 'test.ingest'),
              'worker-A', true, '{"loaded": 10}'::jsonb
          )) AS passed;

-- --- key reuse after completion --------------------------------------------
INSERT INTO platform.jobs (module_id, kind, idempotency_key) VALUES ('grant_intelligence', 'test.ingest', 'day-1');
SELECT 'idempotency: the key frees up once the job is done' AS check,
       count(*) = 2 AS passed
  FROM platform.jobs WHERE kind = 'test.ingest';

-- --- retry with backoff ----------------------------------------------------
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind, max_attempts) VALUES ('grant_intelligence', 'test.flaky', 2);

SELECT (platform.claim_job('worker-A', 'grant_intelligence', 300, ARRAY['test.flaky'])).id AS claimed \gset
SELECT 'retry: a first failure requeues rather than failing' AS check,
       (SELECT status = 'queued' AND run_after > now()
          FROM platform.finish_job(:'claimed'::uuid, 'worker-A', false, NULL, 'boom', 60)) AS passed;

-- Second attempt hits max_attempts.
UPDATE platform.jobs SET run_after = now() WHERE kind = 'test.flaky';
SELECT (platform.claim_job('worker-A', 'grant_intelligence', 300, ARRAY['test.flaky'])).id AS claimed2 \gset
SELECT 'retry: the final failure is terminal' AS check,
       (SELECT status = 'failed' AND last_error = 'boom again'
          FROM platform.finish_job(:'claimed2'::uuid, 'worker-A', false, NULL, 'boom again', 60)) AS passed;

-- --- expired lease recovery ------------------------------------------------
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind) VALUES ('grant_intelligence', 'test.crashed');
SELECT (platform.claim_job('worker-dead', 'grant_intelligence', 300, ARRAY['test.crashed'])).id AS crashed \gset
-- Simulate the worker dying: the lease lapses with the row still 'running'.
UPDATE platform.jobs SET locked_until = now() - interval '1 minute' WHERE id = :'crashed'::uuid;

SELECT 'recovery: an expired lease is reclaimable by another worker' AS check,
       (platform.claim_job('worker-live', 'grant_intelligence', 300, ARRAY['test.crashed'])).locked_by = 'worker-live' AS passed;

-- --- priority ordering -----------------------------------------------------
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind, priority) VALUES ('grant_intelligence', 'test.bulk', 200);
INSERT INTO platform.jobs (module_id, kind, priority) VALUES ('grant_intelligence', 'test.interactive', 10);
SELECT 'priority: interactive work jumps the bulk queue' AS check,
       (platform.claim_job('worker-A', 'grant_intelligence', 300, ARRAY['test.bulk','test.interactive'])).kind
       = 'test.interactive' AS passed;

-- --- constraint: running implies a lease -----------------------------------
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind) VALUES ('grant_intelligence', 'test.constraint');
SAVEPOINT s;
DO $$
BEGIN
    UPDATE platform.jobs SET status = 'running' WHERE kind = 'test.constraint';
    RAISE EXCEPTION 'constraint did not fire';
EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'constraint: running without a lease is rejected -- passed';
END $$;
ROLLBACK TO SAVEPOINT s;

-- --- module isolation ------------------------------------------------------
-- The property that makes the services independently sellable: a customer who
-- bought only Contract Compliance must not have their work sit behind a grant
-- enrichment backlog. These three checks are the whole argument, so they are
-- tested rather than asserted in a comment.
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind, priority)
VALUES ('grant_intelligence', 'test.grants', 10);          -- higher priority
INSERT INTO platform.jobs (module_id, kind, priority)
VALUES ('contract_compliance', 'test.contracts', 200);     -- lower priority

-- Even though the grant job outranks it globally, a contract worker must see
-- only its own module. If this fails, one service can starve another.
SELECT 'isolation: a contract worker never claims grant work' AS check,
       (platform.claim_job('worker-cc', 'contract_compliance', 300,
                           ARRAY['test.grants', 'test.contracts'])).kind
       = 'test.contracts' AS passed;

SELECT 'isolation: the grant job is untouched by the other module''s worker' AS check,
       (SELECT status = 'queued' FROM platform.jobs WHERE kind = 'test.grants') AS passed;

-- A module with nothing queued gets nothing, rather than falling through to
-- whatever else happens to be waiting.
DELETE FROM platform.jobs WHERE kind LIKE 'test.%';
INSERT INTO platform.jobs (module_id, kind) VALUES ('grant_intelligence', 'test.grants');
SELECT 'isolation: an idle module claims nothing from a busy one' AS check,
       platform.claim_job('worker-av', 'audit_compliance', 300, NULL) IS NULL AS passed;

-- --- module attribution ----------------------------------------------------
-- A job that cannot be attributed to a module is a hole in per-service billing
-- and SLA. The database refuses it rather than letting it surface later as a
-- gap in a report.
SAVEPOINT s2;
DO $$
BEGIN
    INSERT INTO platform.jobs (kind) VALUES ('test.orphan');
    RAISE EXCEPTION 'NOT NULL on module_id did not fire';
EXCEPTION WHEN not_null_violation THEN
    RAISE NOTICE 'attribution: a job without a module is rejected -- passed';
END $$;
ROLLBACK TO SAVEPOINT s2;

SAVEPOINT s3;
DO $$
BEGIN
    INSERT INTO platform.jobs (module_id, kind) VALUES ('no_such_module', 'test.orphan');
    RAISE EXCEPTION 'foreign key on module_id did not fire';
EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'attribution: an unknown module is rejected -- passed';
END $$;
ROLLBACK TO SAVEPOINT s3;

ROLLBACK;
