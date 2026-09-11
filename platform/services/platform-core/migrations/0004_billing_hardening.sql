-- 0004: webhook idempotency ledger, customer id, and event ordering.
--
-- Fixes three ways money and access could diverge:
--
-- 1. Stripe delivers webhooks *at least once*. Without a record of processed
--    event ids, a retry re-applies the change. Combined with (3) that could
--    resurrect a cancelled subscription.
-- 2. Delivery is not ordered. A `canceled` event delayed by a retry could
--    arrive after the `active` event that superseded it and revoke access the
--    customer is paying for. `last_event_at` lets us drop stale events.
-- 3. The billing portal is addressed by customer, not subscription, so
--    `stripe_customer_id` has to be stored at subscription time or the customer
--    can never manage or cancel their own plan.

CREATE TABLE IF NOT EXISTS platform.billing_events (
    event_id     text PRIMARY KEY,
    event_type   text NOT NULL,
    tenant_id    uuid REFERENCES platform.tenants(id) ON DELETE SET NULL,
    applied      boolean NOT NULL DEFAULT false,
    detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
    received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_tenant
    ON platform.billing_events (tenant_id, received_at DESC);

ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS stripe_price_id text;
-- Unix timestamp of the Stripe event that last wrote this row.
ALTER TABLE platform.subscriptions
    ADD COLUMN IF NOT EXISTS last_event_at bigint;

CREATE INDEX IF NOT EXISTS idx_subscriptions_customer
    ON platform.subscriptions (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON platform.billing_events TO zeus_app;
