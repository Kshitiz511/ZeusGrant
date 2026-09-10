CREATE TABLE public.security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.security_audit_log TO authenticated;
GRANT ALL ON public.security_audit_log TO service_role;
ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_log_select_own" ON public.security_audit_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "audit_log_insert_own" ON public.security_audit_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
-- No UPDATE or DELETE policies, ever: the trail is append-only.

CREATE INDEX security_audit_log_user_created_idx
  ON public.security_audit_log (user_id, created_at DESC);
CREATE INDEX security_audit_log_action_idx
  ON public.security_audit_log (user_id, action);

CREATE TABLE public.api_rate_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.api_rate_log TO authenticated;
GRANT ALL ON public.api_rate_log TO service_role;
ALTER TABLE public.api_rate_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_rate_log_select_own" ON public.api_rate_log
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX api_rate_log_user_action_idx
  ON public.api_rate_log (user_id, action, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_rate_limit(_action TEXT, _limit_per_hour INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _used integer;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_authenticated');
  END IF;

  SELECT count(*) INTO _used
  FROM public.api_rate_log
  WHERE user_id = _uid AND action = _action AND created_at > now() - interval '1 hour';

  IF _used >= _limit_per_hour THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited',
      'used', _used, 'limit', _limit_per_hour);
  END IF;

  INSERT INTO public.api_rate_log (user_id, action) VALUES (_uid, _action);

  RETURN jsonb_build_object('allowed', true, 'used', _used + 1, 'limit', _limit_per_hour);
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER) TO authenticated, service_role;