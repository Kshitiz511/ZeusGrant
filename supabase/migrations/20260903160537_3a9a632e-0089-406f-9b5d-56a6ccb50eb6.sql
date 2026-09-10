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
  _trialing boolean;
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

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _uid AND status = 'trialing'
      AND (current_period_end IS NULL OR current_period_end > now())
  ) INTO _trialing;

  -- Free trial: one draft per cycle regardless of the selected plan.
  IF _trialing THEN
    _cap := 1;
  END IF;

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

REVOKE EXECUTE ON FUNCTION public.consume_proposal_draft(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.consume_proposal_draft(text) TO authenticated, service_role;