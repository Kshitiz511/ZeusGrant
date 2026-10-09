-- 0019: password reset codes share the email_verifications machinery.
--
-- A reset code has exactly the same shape and threat model as a verification
-- code: six digits, hashed at rest, short expiry, server-side attempt limit,
-- superseded on resend. A second table would duplicate every one of those
-- rules. Instead each row carries a purpose, and every lookup filters on it so
-- a signup code can never be spent as a reset code (or the reverse).

ALTER TABLE platform.email_verifications
    ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'verify';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'email_verifications_purpose_check'
    ) THEN
        ALTER TABLE platform.email_verifications
            ADD CONSTRAINT email_verifications_purpose_check
            CHECK (purpose IN ('verify', 'password_reset'));
    END IF;
END $$;

DROP INDEX IF EXISTS platform.idx_email_verifications_live;
CREATE INDEX IF NOT EXISTS idx_email_verifications_live
    ON platform.email_verifications(user_id, purpose)
    WHERE consumed_at IS NULL;
