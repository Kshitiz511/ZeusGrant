-- ---------------------------------------------------------------------------
-- 0013: row level security on the platform schema's tenant-scoped tables.
--
-- The contract_compliance schema has had RLS since 0002. The platform schema
-- never got the same treatment, so eight tables holding a tenant_id --
-- including org_profiles and opportunity_matches, the whole of Grant
-- Intelligence's per-tenant state -- were protected by nothing but each query
-- remembering to say "WHERE tenant_id = $1".
--
-- Every query does currently say it. That is not the point. The predicate is
-- something a person has to get right every time, in a codebase that is
-- growing, and the failure mode is silent: one forgotten clause returns
-- another customer's rows with no error and no log line.
--
-- ---------------------------------------------------------------------------
-- Why these policies have a NULL branch
-- ---------------------------------------------------------------------------
-- The obvious policy -- tenant_id = current_setting('app.current_tenant') --
-- was written first and tested against the role production actually uses
-- (zeus_app, which is not a superuser and so cannot bypass RLS). It failed
-- immediately:
--
--     new row violates row-level security policy for table "subscriptions"
--
-- because a great deal of legitimate work runs with no tenant bound at all:
-- signup creating the first subscription, the entitlements refresh, Stripe
-- webhooks, the worker claiming a job, and the membership lookup that decides
-- which tenant may be bound in the first place. With nothing bound the
-- setting is NULL, "tenant_id = NULL" is NULL, and every one of those paths
-- either returns nothing or is refused. Shipping that would have taken down
-- signup and billing to gain isolation the application already enforces by
-- hand.
--
-- So the policy says: when a tenant is bound, rows are restricted to it; when
-- none is bound, this is platform-level work and the query is left alone.
--
-- Be precise about what that buys. It is not a boundary against a caller who
-- binds nothing -- it is defence in depth for every request that goes through
-- the guard, which is the entire tenant-facing surface. Those requests are
-- currently isolated only by a hand-written predicate; after this they are
-- isolated by the database too, and a forgotten WHERE clause stops being able
-- to leak anything. That is a real improvement over no policy, and unlike the
-- strict form it cannot break the platform paths.
--
-- What RLS still cannot do, and must not be mistaken for: it pins to whatever
-- app.current_tenant the application binds, so it isolates faithfully to the
-- wrong tenant if the wrong one is bound. Only the membership check in the
-- request path can tell the difference. The two answer different questions.
--
-- FORCE is applied with ENABLE. ENABLE alone exempts the table owner, and on
-- hosted Postgres the migration role owns these tables, so a runtime DSN using
-- that role would bypass isolation entirely while every test still passed --
-- the lesson 0005 recorded for the other schema.
-- ---------------------------------------------------------------------------

DO $outer$
DECLARE
    _table text;
BEGIN
    FOREACH _table IN ARRAY ARRAY[
        'org_profiles',
        'opportunity_matches',
        'jobs',
        'ai_usage',
        'subscriptions',
        'entitlements',
        'billing_events',
        'memberships'
    ]
    LOOP
        EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', _table);
        EXECUTE format('ALTER TABLE platform.%I FORCE  ROW LEVEL SECURITY', _table);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON platform.%I', _table);

        -- USING governs reads and which rows an UPDATE may touch; WITH CHECK
        -- governs what may be written. Both are needed: USING alone would let
        -- a bound tenant insert a row belonging to somebody else.
        --
        -- nullif() rather than a plain OR on the empty string. Postgres does
        -- not promise to short-circuit OR, so it may evaluate the ::uuid cast
        -- even when the first branch is already true -- and an unbound
        -- connection reports '' rather than NULL once the setting has been
        -- set and reset, which fails the cast outright:
        --     invalid input syntax for type uuid: ""
        -- Folding '' to NULL inside the cast makes both "never set" and
        -- "set then cleared" mean the same thing and removes the cast error.
        EXECUTE format($policy$
            CREATE POLICY tenant_isolation ON platform.%I
                USING (
                    nullif(current_setting('app.current_tenant', true), '') IS NULL
                    OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
                )
                WITH CHECK (
                    nullif(current_setting('app.current_tenant', true), '') IS NULL
                    OR tenant_id = nullif(current_setting('app.current_tenant', true), '')::uuid
                )
        $policy$, _table);
    END LOOP;
END;
$outer$;


-- ---------------------------------------------------------------------------
-- The application role must not be able to opt out
-- ---------------------------------------------------------------------------
-- Stated explicitly rather than assumed. A role with BYPASSRLS makes every
-- policy above decorative, and nothing in the schema would show it.
DO $roles$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
        EXECUTE 'ALTER ROLE zeus_app NOBYPASSRLS';
    END IF;
EXCEPTION
    -- Managed Postgres may not grant the migration role authority over roles.
    -- Not fatal: verify_schema.py asserts the same property and fails the
    -- build if it is ever untrue.
    WHEN insufficient_privilege THEN
        RAISE NOTICE 'Could not set NOBYPASSRLS on zeus_app; verified separately.';
END;
$roles$;
