-- ---------------------------------------------------------------------------
-- 0003: First-party email/password credentials.
--
-- platform.users mirrors whichever auth provider is active. For first-party
-- auth (dev + simple prod), we store a scrypt password hash alongside. When a
-- tenant uses SSO/Supabase-hosted auth instead, they simply have no row here.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform.user_credentials (
    user_id       uuid PRIMARY KEY REFERENCES platform.users(id) ON DELETE CASCADE,
    password_hash text NOT NULL,        -- format: scrypt$<salt-hex>$<hash-hex>
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- zeus_app may not exist yet on a fresh database (it's created by the
-- contract-compliance RLS migration, which runs later). Create idempotently.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'zeus_app') THEN
        CREATE ROLE zeus_app LOGIN PASSWORD 'zeus_app' NOSUPERUSER NOCREATEDB NOCREATEROLE;
    END IF;
END $$;

GRANT USAGE ON SCHEMA platform TO zeus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_credentials TO zeus_app;
