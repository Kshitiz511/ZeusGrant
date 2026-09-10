
-- Grant Tracker ------------------------------------------------------------
CREATE TABLE public.grant_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  opportunity_slug text,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  grant_name text NOT NULL,
  funder text NOT NULL,
  funder_type text NOT NULL DEFAULT 'federal',
  focus_areas text[] NOT NULL DEFAULT '{}',
  stage text NOT NULL DEFAULT 'identified',
  outcome text NOT NULL DEFAULT 'pending',
  match_score integer,
  requested_amount numeric,
  submitted_amount numeric,
  awarded_amount numeric,
  deadline date,
  submission_date date,
  decision_date_expected date,
  decision_date_actual date,
  funder_contact_name text,
  funder_contact_email text,
  funder_contact_phone text,
  portal_url text,
  internal_notes text,
  tags text[] NOT NULL DEFAULT '{}',
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_records TO authenticated;
GRANT ALL ON public.grant_records TO service_role;
ALTER TABLE public.grant_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_records_all_own ON public.grant_records FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER grant_records_updated_at BEFORE UPDATE ON public.grant_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX grant_records_user_stage_idx ON public.grant_records (user_id, stage);

CREATE TABLE public.grant_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_record_id uuid NOT NULL REFERENCES public.grant_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_stage_history TO authenticated;
GRANT ALL ON public.grant_stage_history TO service_role;
ALTER TABLE public.grant_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_stage_history_all_own ON public.grant_stage_history FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.grant_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_record_id uuid NOT NULL REFERENCES public.grant_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_activity_log TO authenticated;
GRANT ALL ON public.grant_activity_log TO service_role;
ALTER TABLE public.grant_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_activity_log_all_own ON public.grant_activity_log FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.grant_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_record_id uuid NOT NULL REFERENCES public.grant_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  storage_path text NOT NULL,
  size_bytes integer,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_documents TO authenticated;
GRANT ALL ON public.grant_documents TO service_role;
ALTER TABLE public.grant_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_documents_all_own ON public.grant_documents FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER grant_documents_updated_at BEFORE UPDATE ON public.grant_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.grant_reporting_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_record_id uuid NOT NULL REFERENCES public.grant_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL DEFAULT 'progress',
  title text NOT NULL,
  due_date date,
  submitted_date date,
  document_id uuid REFERENCES public.grant_documents(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_reporting_items TO authenticated;
GRANT ALL ON public.grant_reporting_items TO service_role;
ALTER TABLE public.grant_reporting_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_reporting_items_all_own ON public.grant_reporting_items FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER grant_reporting_items_updated_at BEFORE UPDATE ON public.grant_reporting_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.grant_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_record_id uuid NOT NULL REFERENCES public.grant_records(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_email text,
  member_role text NOT NULL DEFAULT 'Lead Writer',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grant_team_members TO authenticated;
GRANT ALL ON public.grant_team_members TO service_role;
ALTER TABLE public.grant_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY grant_team_members_all_own ON public.grant_team_members FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Plan capability flags for the tracker -------------------------------------
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS tracker_csv_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracker_pdf_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tracker_team_assignment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_contracts_max integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS compliance_timeline_view boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_budget_tracking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_health_score boolean NOT NULL DEFAULT false;

UPDATE public.plan_limits SET
  tracker_csv_export = plan_id IN ('growth','professional','agency','enterprise'),
  tracker_pdf_report = plan_id IN ('professional','agency','enterprise'),
  tracker_team_assignment = plan_id IN ('growth','professional','agency','enterprise'),
  compliance_timeline_view = plan_id IN ('growth','professional','agency','enterprise'),
  compliance_budget_tracking = plan_id IN ('growth','professional','agency','enterprise'),
  compliance_health_score = plan_id IN ('professional','agency','enterprise'),
  compliance_contracts_max = CASE plan_id
    WHEN 'starter' THEN 2
    WHEN 'growth' THEN 10
    ELSE NULL END
WHERE true;
