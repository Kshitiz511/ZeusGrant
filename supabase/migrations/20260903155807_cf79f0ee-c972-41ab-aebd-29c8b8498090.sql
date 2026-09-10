
ALTER TABLE public.usage_counters
  ADD COLUMN IF NOT EXISTS addon_drafts_purchased integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS addon_drafts_used integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_end date;

ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS white_label_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS duplicate_enabled boolean NOT NULL DEFAULT false;

UPDATE public.plan_limits SET white_label_export = false, duplicate_enabled = false WHERE plan_id IN ('starter');
UPDATE public.plan_limits SET duplicate_enabled = true WHERE plan_id IN ('growth','professional','agency');
UPDATE public.plan_limits SET white_label_export = true WHERE plan_id = 'agency';

CREATE TABLE IF NOT EXISTS public.proposal_addon_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addon_id text NOT NULL,
  price_id text NOT NULL,
  drafts_granted integer NOT NULL DEFAULT 0,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'paid',
  cycle_start date,
  stripe_session_id text UNIQUE,
  environment text NOT NULL DEFAULT 'sandbox',
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.proposal_addon_purchases TO authenticated;
GRANT ALL ON public.proposal_addon_purchases TO service_role;
ALTER TABLE public.proposal_addon_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "addon_purchases_select_own" ON public.proposal_addon_purchases
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER proposal_addon_purchases_updated_at BEFORE UPDATE ON public.proposal_addon_purchases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.proposal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.proposal_events TO authenticated;
GRANT ALL ON public.proposal_events TO service_role;
ALTER TABLE public.proposal_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proposal_events_select_own" ON public.proposal_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "proposal_events_insert_own" ON public.proposal_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Billing cycle anniversary (monthly), derived from the subscription start.
CREATE OR REPLACE FUNCTION public.billing_cycle_start(_user_id uuid, _env text DEFAULT 'sandbox')
RETURNS date
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _start timestamptz;
  _months integer;
BEGIN
  SELECT current_period_start INTO _start
  FROM public.subscriptions
  WHERE user_id = _user_id AND environment = _env
  ORDER BY created_at DESC
  LIMIT 1;

  IF _start IS NULL THEN
    RETURN date_trunc('month', now())::date;
  END IF;

  _months := GREATEST(0, (date_part('year', now()) - date_part('year', _start))::int * 12
             + (date_part('month', now()) - date_part('month', _start))::int
             - CASE WHEN date_part('day', now()) < date_part('day', _start) THEN 1 ELSE 0 END);

  RETURN (_start + (_months || ' months')::interval)::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.my_billing_cycle_start(_env text DEFAULT 'sandbox')
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.billing_cycle_start(auth.uid(), _env)
$$;

-- Atomic proposal-draft consumption: plan allowance first, then add-on drafts.
CREATE OR REPLACE FUNCTION public.consume_proposal_draft(_env text DEFAULT 'sandbox')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _price text;
  _cap integer;
  _cycle date;
  _row public.usage_counters%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  _price := COALESCE(public.active_price_id(_uid, _env), public.active_price_id(_uid, CASE WHEN _env = 'sandbox' THEN 'live' ELSE 'sandbox' END));
  IF _price IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  END IF;

  SELECT proposal_drafts_per_month INTO _cap FROM public.plan_limits WHERE price_id = _price;
  _cycle := public.billing_cycle_start(_uid, _env);

  SELECT * INTO _row FROM public.usage_counters
   WHERE user_id = _uid AND period_start = _cycle FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.usage_counters (user_id, period_start, period_end)
    VALUES (_uid, _cycle, (_cycle + interval '1 month')::date)
    RETURNING * INTO _row;
  END IF;

  IF _cap IS NULL OR _row.proposal_drafts_used < _cap THEN
    UPDATE public.usage_counters SET proposal_drafts_used = proposal_drafts_used + 1
     WHERE id = _row.id RETURNING * INTO _row;
    RETURN jsonb_build_object('allowed', true, 'source', 'plan',
      'used', _row.proposal_drafts_used, 'cap', _cap,
      'addon_remaining', _row.addon_drafts_purchased - _row.addon_drafts_used);
  END IF;

  IF _row.addon_drafts_used < _row.addon_drafts_purchased THEN
    UPDATE public.usage_counters SET addon_drafts_used = addon_drafts_used + 1
     WHERE id = _row.id RETURNING * INTO _row;
    RETURN jsonb_build_object('allowed', true, 'source', 'addon',
      'used', _row.proposal_drafts_used, 'cap', _cap,
      'addon_remaining', _row.addon_drafts_purchased - _row.addon_drafts_used);
  END IF;

  INSERT INTO public.proposal_events (user_id, event, metadata)
  VALUES (_uid, 'proposal.limit_reached', jsonb_build_object('price_id', _price, 'cap', _cap));

  RETURN jsonb_build_object('allowed', false, 'reason', 'limit_reached', 'cap', _cap,
    'used', _row.proposal_drafts_used);
END;
$$;
