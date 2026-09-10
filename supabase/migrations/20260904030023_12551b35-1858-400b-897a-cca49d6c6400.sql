-- Team members
CREATE TABLE public.org_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_email text NOT NULL,
  member_role text NOT NULL DEFAULT 'contributor',
  status text NOT NULL DEFAULT 'invited',
  invited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, member_email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_team_members TO authenticated;
GRANT ALL ON public.org_team_members TO service_role;
ALTER TABLE public.org_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own team members" ON public.org_team_members
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER org_team_members_updated_at BEFORE UPDATE ON public.org_team_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Client workspaces
CREATE TABLE public.client_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  org_type text,
  mission text,
  city text,
  state text,
  country text NOT NULL DEFAULT 'United States',
  operating_states text[] NOT NULL DEFAULT '{}',
  focus_areas text[] NOT NULL DEFAULT '{}',
  populations_served text[] NOT NULL DEFAULT '{}',
  funding_amount_min numeric,
  funding_amount_max numeric,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_workspaces TO authenticated;
GRANT ALL ON public.client_workspaces TO service_role;
ALTER TABLE public.client_workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own client workspaces" ON public.client_workspaces
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER client_workspaces_updated_at BEFORE UPDATE ON public.client_workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Funding scan runs
CREATE TABLE public.funding_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scan_type text NOT NULL DEFAULT 'manual',
  frequency text NOT NULL DEFAULT 'monthly',
  matches_found integer NOT NULL DEFAULT 0,
  new_matches integer NOT NULL DEFAULT 0,
  workspace_id uuid REFERENCES public.client_workspaces(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.funding_scan_runs TO authenticated;
GRANT ALL ON public.funding_scan_runs TO service_role;
ALTER TABLE public.funding_scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scan runs" ON public.funding_scan_runs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Email report settings
CREATE TABLE public.email_report_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  frequency text NOT NULL DEFAULT 'weekly',
  recipients text[] NOT NULL DEFAULT '{}',
  min_fit_score integer NOT NULL DEFAULT 60,
  last_sent_at timestamptz,
  next_send_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_report_settings TO authenticated;
GRANT ALL ON public.email_report_settings TO service_role;
ALTER TABLE public.email_report_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own email report settings" ON public.email_report_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER email_report_settings_updated_at BEFORE UPDATE ON public.email_report_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Email report log
CREATE TABLE public.email_report_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  opportunity_count integer NOT NULL DEFAULT 0,
  trigger_source text NOT NULL DEFAULT 'scheduled',
  status text NOT NULL DEFAULT 'sent',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.email_report_log TO authenticated;
GRANT ALL ON public.email_report_log TO service_role;
ALTER TABLE public.email_report_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own email report log" ON public.email_report_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Plan feature flags
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS scan_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS email_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calendar_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_analytics boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority_support boolean NOT NULL DEFAULT false;

UPDATE public.plan_limits SET scan_frequency = 'monthly', email_reports = false,
  calendar_export = false, usage_analytics = false, priority_support = false,
  team_seats = 1, client_workspaces = 1
  WHERE plan_id = 'starter';
UPDATE public.plan_limits SET scan_frequency = 'weekly', email_reports = true,
  calendar_export = false, usage_analytics = false, priority_support = false,
  team_seats = 4, client_workspaces = 1
  WHERE plan_id = 'growth';
UPDATE public.plan_limits SET scan_frequency = 'daily', email_reports = true,
  calendar_export = true, usage_analytics = false, priority_support = true,
  team_seats = 11, client_workspaces = 1
  WHERE plan_id = 'professional';
UPDATE public.plan_limits SET scan_frequency = 'daily', email_reports = true,
  calendar_export = true, usage_analytics = true, priority_support = true,
  team_seats = 25, client_workspaces = 10
  WHERE plan_id = 'agency';