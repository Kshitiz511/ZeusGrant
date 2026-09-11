-- ---------------------------------------------------------------------------
-- 0005: Refresh-token sessions (httpOnly cookie auth).
--
-- Access JWTs stay short-lived and in browser memory. Durability across a page
-- reload comes from an opaque refresh token delivered in an httpOnly cookie,
-- and this table is its server-side record.
--
-- Two properties matter more than anything else here:
--
--   * We store only sha256(token). A dump of this table therefore cannot be
--     replayed as a login, the same reason we never store raw passwords.
--   * Every row carries a `family_id`. Rotation issues a new row in the same
--     family and stamps `used_at` on the old one, so if a *used* token is ever
--     presented again we know the cookie was captured and can kill the whole
--     family at once. That is the standard OAuth refresh-token reuse detection
--     and it is what turns silent token theft into a forced re-login.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform.user_sessions (
    id             uuid PRIMARY KEY,
    family_id      uuid NOT NULL,
    user_id        uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
    token_hash     text NOT NULL,          -- sha256 hex of the opaque refresh token
    csrf_hash      text NOT NULL,          -- sha256 hex of the double-submit CSRF token
    issued_at      timestamptz NOT NULL DEFAULT now(),
    expires_at     timestamptz NOT NULL,   -- absolute deadline; rotation never extends it
    used_at        timestamptz,            -- set when rotated; a second use means theft
    revoked_at     timestamptz,
    revoked_reason text,
    user_agent     text,
    ip             inet
);

-- Lookup is always by token hash, and the uniqueness is what makes the
-- "rotate exactly once" UPDATE safe under concurrent refreshes.
CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_token_hash_key
    ON platform.user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS user_sessions_family_idx
    ON platform.user_sessions (family_id);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx
    ON platform.user_sessions (user_id);
-- Supports the expiry sweep without scanning live sessions.
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx
    ON platform.user_sessions (expires_at);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
        CREATE ROLE zeus_app LOGIN PASSWORD 'zeus_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO zeus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_sessions TO zeus_app;
