REVOKE ALL ON FUNCTION public.enforce_saved_opportunity_limit() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.active_price_id(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.active_price_id(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.plan_limit_for(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.plan_limit_for(uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.my_active_price_id(_env text DEFAULT 'sandbox')
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.active_price_id(auth.uid(), _env)
$$;

REVOKE ALL ON FUNCTION public.my_active_price_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_active_price_id(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_plan_limit(_limit text, _env text DEFAULT 'sandbox')
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.plan_limit_for(auth.uid(), _limit, _env)
$$;

REVOKE ALL ON FUNCTION public.my_plan_limit(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_plan_limit(text, text) TO authenticated, service_role;