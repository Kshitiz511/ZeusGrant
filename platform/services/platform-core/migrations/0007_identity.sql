-- 0007: Identity hardening — real names, verified email, and federated logins.
--
-- Three gaps this closes:
--
-- 1. We collected an email and nothing else. "Who is this?" had no answer
--    beyond a mailbox, which is thin for a product holding funder agreements.
--
-- 2. Nothing proved the email belonged to the person typing it. Anyone could
--    sign up as anyone, and every unverified signup starts a trial that spends
--    real money on model calls.
--
-- 3. Federated logins (Google, and whatever follows) need somewhere to live.
--    Putting the provider's subject id on platform.users directly would allow
--    exactly one provider per user forever, so identities get their own table
--    with a row per provider.

-- --- Users: name and verification state -------------------------------------
ALTER TABLE platform.users
    ADD COLUMN IF NOT EXISTS full_name         text,
    -- Nullable timestamp rather than a boolean: "when was this verified" is a
    -- question auditors ask, and a boolean cannot answer it.
    ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- --- Federated identities ----------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.user_identities (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
    provider     text NOT NULL CHECK (provider IN ('google')),
    -- The provider's stable subject id. Deliberately NOT the email: people
    -- change their email address at Google, and matching on a mutable field
    -- would either orphan the account or hand it to whoever inherits the
    -- address next.
    subject      text NOT NULL,
    email        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    UNIQUE (provider, subject)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
    ON platform.user_identities(user_id);

-- --- Email verification codes ------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.email_verifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES platform.users(id) ON DELETE CASCADE,
    email        text NOT NULL,
    -- Only the hash is stored. A leaked database should not hand out working
    -- verification codes, and we never need the original back.
    code_hash    text NOT NULL,
    expires_at   timestamptz NOT NULL,
    consumed_at  timestamptz,
    -- Counted server-side so a 6-digit code cannot be brute forced. At 10
    -- attempts the row is spent regardless of whether the code was ever right.
    attempts     smallint NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user
    ON platform.email_verifications(user_id, created_at DESC);

-- Partial index over live codes only; consumed and expired rows are the vast
-- majority over time and never need looking up.
CREATE INDEX IF NOT EXISTS idx_email_verifications_live
    ON platform.email_verifications(user_id)
    WHERE consumed_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.user_identities    TO zeus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.email_verifications TO zeus_app;
