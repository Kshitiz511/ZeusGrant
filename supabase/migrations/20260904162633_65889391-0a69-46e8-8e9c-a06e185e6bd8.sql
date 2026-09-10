-- Platform staff helpers
CREATE OR REPLACE FUNCTION public.is_platform_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role IN ('platform_admin'::public.app_role, 'platform_support'::public.app_role));
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id
    AND role = 'platform_admin'::public.app_role);
$$;

REVOKE EXECUTE ON FUNCTION public.is_platform_staff(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(uuid) FROM anon;

-- AI job log
CREATE TABLE IF NOT EXISTS public.ai_job_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  model_used text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),
  error_message text,
  request_summary jsonb,
  related_entity_id uuid,
  related_entity_type text
);
GRANT SELECT, INSERT, UPDATE ON public.ai_job_log TO authenticated;
GRANT ALL ON public.ai_job_log TO service_role;
ALTER TABLE public.ai_job_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or staff read ai jobs" ON public.ai_job_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_staff(auth.uid()));
CREATE POLICY "Users log own ai jobs" ON public.ai_job_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own ai jobs" ON public.ai_job_log FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS ai_job_log_user_time ON public.ai_job_log(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_job_log_status_time ON public.ai_job_log(status, started_at DESC);
CREATE INDEX IF NOT EXISTS ai_job_log_type_time ON public.ai_job_log(job_type, started_at DESC);

-- Platform error log
CREATE TABLE IF NOT EXISTS public.platform_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  error_type text NOT NULL,
  source_function text,
  message text NOT NULL,
  stacktrace text,
  request_context jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.platform_error_log TO authenticated;
GRANT ALL ON public.platform_error_log TO service_role;
ALTER TABLE public.platform_error_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or staff read errors" ON public.platform_error_log FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_platform_staff(auth.uid()));
CREATE POLICY "Users log own errors" ON public.platform_error_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins resolve errors" ON public.platform_error_log FOR UPDATE TO authenticated
  USING (public.is_platform_admin(auth.uid())) WITH CHECK (public.is_platform_admin(auth.uid()));
CREATE INDEX IF NOT EXISTS platform_error_log_time ON public.platform_error_log(created_at DESC);

-- Platform configuration (feature flags, rate limits, banner)
CREATE TABLE IF NOT EXISTS public.platform_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
GRANT SELECT ON public.platform_config TO authenticated;
GRANT ALL ON public.platform_config TO service_role;
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read platform config" ON public.platform_config FOR SELECT TO authenticated USING (true);

INSERT INTO public.platform_config (key, value) VALUES
  ('rate_limits', '{"website_scrape":10,"contract_extraction":20,"proposal_generate":10,"team_recommend":30,"match_rescore":5,"capability_match":20}'::jsonb),
  ('feature_flags', '{"ai_team_recommendation":true,"module_3_evidence_vault":true,"agency_portal":true,"maintenance_mode":false}'::jsonb),
  ('announcement_banner', '""'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Admin notes/flags on accounts
CREATE TABLE IF NOT EXISTS public.admin_account_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_user_id uuid NOT NULL,
  flagged boolean NOT NULL DEFAULT true,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_account_flags_account ON public.admin_account_flags(account_user_id);
GRANT SELECT ON public.admin_account_flags TO authenticated;
GRANT ALL ON public.admin_account_flags TO service_role;
ALTER TABLE public.admin_account_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read account flags" ON public.admin_account_flags FOR SELECT TO authenticated
  USING (public.is_platform_staff(auth.uid()));
