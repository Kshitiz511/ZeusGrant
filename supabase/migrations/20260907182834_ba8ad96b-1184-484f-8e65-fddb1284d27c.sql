INSERT INTO public.plan_limits (
  price_id, plan_id, saved_opportunities_max, matches_per_month, proposal_drafts_per_month,
  team_seats, client_workspaces, export_enabled, templates_enabled, compliance_level,
  white_label_export, duplicate_enabled, tracker_csv_export, tracker_pdf_report,
  tracker_team_assignment, compliance_contracts_max, compliance_timeline_view,
  compliance_budget_tracking, compliance_health_score, scan_frequency, email_reports,
  calendar_export, usage_analytics, priority_support)
SELECT p || l.price_id, l.plan_id, l.saved_opportunities_max, l.matches_per_month, l.proposal_drafts_per_month,
  l.team_seats, l.client_workspaces, l.export_enabled, l.templates_enabled, l.compliance_level,
  l.white_label_export, l.duplicate_enabled, l.tracker_csv_export, l.tracker_pdf_report,
  l.tracker_team_assignment, l.compliance_contracts_max, l.compliance_timeline_view,
  l.compliance_budget_tracking, l.compliance_health_score, l.scan_frequency, l.email_reports,
  l.calendar_export, l.usage_analytics, l.priority_support
FROM public.plan_limits l
CROSS JOIN (VALUES ('gi_'),('cc_'),('ac_')) AS pre(p)
WHERE l.price_id ~ '^(starter|growth|professional|agency)_'
ON CONFLICT (price_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.gi_price_id(_user_id uuid, _env text DEFAULT 'sandbox'::text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT price_id
  FROM public.subscriptions
  WHERE user_id = _user_id
    AND environment = _env
    AND (price_id ~ '^gi_' OR price_id ~ '^(starter|growth|professional|agency)_')
    AND (
      (status IN ('active','trialing','past_due') AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'canceled' AND current_period_end > now())
    )
  ORDER BY
    CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
    created_at DESC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.consume_proposal_draft(_env text DEFAULT 'sandbox'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  _price := COALESCE(public.gi_price_id(_uid, _env), public.gi_price_id(_uid, CASE WHEN _env = 'sandbox' THEN 'live' ELSE 'sandbox' END));
  IF _price IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_subscription');
  END IF;

  SELECT proposal_drafts_per_month INTO _cap FROM public.plan_limits WHERE price_id = _price;

  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _uid AND status = 'trialing'
      AND price_id = _price
      AND (current_period_end IS NULL OR current_period_end > now())
  ) INTO _trialing;

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
$function$;