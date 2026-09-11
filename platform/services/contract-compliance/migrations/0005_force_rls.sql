-- ---------------------------------------------------------------------------
-- 0005: FORCE row level security on every tenant-scoped table.
--
-- `ENABLE ROW LEVEL SECURITY` exempts the table owner. That is invisible
-- locally, where the app connects as the non-owner `zeus_app`, but it means
-- isolation depends entirely on *which role connects* rather than on the
-- policy itself. On a hosted Postgres the migration role owns these tables, so
-- a runtime DSN using that role would bypass tenant isolation completely while
-- every test still passed.
--
-- FORCE removes the exemption: the policy applies to the owner too, and
-- isolation becomes a property of the table rather than of the connection.
-- 0004 already did this for ai_usage; this backfills the four older tables.
--
-- Idempotent: FORCE is a no-op if already set.
-- ---------------------------------------------------------------------------

ALTER TABLE contract_compliance.contracts    FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.obligations  FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.documents    FORCE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance.audit_log    FORCE ROW LEVEL SECURITY;
