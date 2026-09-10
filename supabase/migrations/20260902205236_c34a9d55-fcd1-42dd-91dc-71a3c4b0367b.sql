ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_used boolean NOT NULL DEFAULT false;

CREATE TABLE public.plan_limits (
  price_id text PRIMARY KEY,
  plan_id text NOT NULL,
  saved_opportunities_max integer,
  matches_per_month integer,
  proposal_drafts_per_month integer,
  team_seats integer,
  client_workspaces integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plan_limits TO authenticated;
GRANT SELECT ON public.plan_limits TO anon;
GRANT ALL ON public.plan_limits TO service_role;

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plan limits"
  ON public.plan_limits FOR SELECT
  USING (true);

CREATE TRIGGER plan_limits_updated_at
  BEFORE UPDATE ON public.plan_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.plan_limits
  (price_id, plan_id, saved_opportunities_max, matches_per_month, proposal_drafts_per_month, team_seats, client_workspaces)
VALUES
  ('starter_monthly',      'starter',      5,    25,   1,  1,  1),
  ('starter_annual',       'starter',      5,    25,   1,  1,  1),
  ('growth_monthly',       'growth',       NULL, 100,  5,  4,  1),
  ('growth_annual',        'growth',       NULL, 100,  5,  4,  1),
  ('professional_monthly', 'professional', NULL, NULL, 15, 11, 1),
  ('professional_annual',  'professional', NULL, NULL, 15, 11, 1),
  ('agency_monthly',       'agency',       NULL, NULL, 40, 25, 10),
  ('agency_annual',        'agency',       NULL, NULL, 40, 25, 10);

CREATE TABLE public.usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  matches_used integer NOT NULL DEFAULT 0,
  proposal_drafts_used integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_start)
);

CREATE INDEX idx_usage_counters_user ON public.usage_counters(user_id, period_start);

GRANT SELECT, INSERT, UPDATE ON public.usage_counters TO authenticated;
GRANT ALL ON public.usage_counters TO service_role;

ALTER TABLE public.usage_counters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_counters_select_own"
  ON public.usage_counters FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "usage_counters_insert_own"
  ON public.usage_counters FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "usage_counters_update_own"
  ON public.usage_counters FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER usage_counters_updated_at
  BEFORE UPDATE ON public.usage_counters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.active_price_id(_user_id uuid, _env text DEFAULT 'sandbox')
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT price_id
  FROM public.subscriptions
  WHERE user_id = _user_id
    AND environment = _env
    AND (
      (status IN ('active','trialing','past_due') AND (current_period_end IS NULL OR current_period_end > now()))
      OR (status = 'canceled' AND current_period_end > now())
    )
  ORDER BY
    CASE status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 WHEN 'past_due' THEN 2 ELSE 3 END,
    created_at DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.active_price_id(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_price_id(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.plan_limit_for(_user_id uuid, _limit text, _env text DEFAULT 'sandbox')
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price text;
  _row public.plan_limits%ROWTYPE;
BEGIN
  _price := public.active_price_id(_user_id, _env);
  IF _price IS NULL THEN
    RETURN 0;
  END IF;
  SELECT * INTO _row FROM public.plan_limits WHERE price_id = _price;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN CASE _limit
    WHEN 'saved_opportunities' THEN _row.saved_opportunities_max
    WHEN 'matches' THEN _row.matches_per_month
    WHEN 'proposal_drafts' THEN _row.proposal_drafts_per_month
    WHEN 'team_seats' THEN _row.team_seats
    WHEN 'client_workspaces' THEN _row.client_workspaces
    ELSE NULL
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.plan_limit_for(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plan_limit_for(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_saved_opportunity_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _price text;
  _cap integer;
  _count integer;
BEGIN
  _price := COALESCE(
    public.active_price_id(NEW.user_id, 'sandbox'),
    public.active_price_id(NEW.user_id, 'live')
  );

  IF _price IS NULL THEN
    RAISE EXCEPTION 'An active subscription or free trial is required to save opportunities.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT saved_opportunities_max INTO _cap FROM public.plan_limits WHERE price_id = _price;

  IF _cap IS NOT NULL THEN
    SELECT count(*) INTO _count FROM public.saved_opportunities WHERE user_id = NEW.user_id;
    IF _count >= _cap THEN
      RAISE EXCEPTION 'Your plan allows up to % saved opportunities. Upgrade to save more.', _cap
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER saved_opportunities_limit
  BEFORE INSERT ON public.saved_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.enforce_saved_opportunity_limit();