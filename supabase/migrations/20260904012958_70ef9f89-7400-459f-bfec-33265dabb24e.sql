-- Contract-level additions
ALTER TABLE public.compliance_contracts
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS health_score integer,
  ADD COLUMN IF NOT EXISTS health_score_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_name text,
  ADD COLUMN IF NOT EXISTS default_reminder_days integer[] NOT NULL DEFAULT ARRAY[30,14,7,3,1];

-- Obligation-level additions
ALTER TABLE public.compliance_obligations
  ADD COLUMN IF NOT EXISTS submit_to_name text,
  ADD COLUMN IF NOT EXISTS submit_to_email text,
  ADD COLUMN IF NOT EXISTS submit_to_address text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS recurrence_rule text,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS cycles_completed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cycles_on_time integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS series_ended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submission_confirmation text,
  ADD COLUMN IF NOT EXISTS completed_by uuid,
  ADD COLUMN IF NOT EXISTS reminders_silenced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_days integer[];

-- Task assignees
CREATE TABLE IF NOT EXISTS public.compliance_task_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.compliance_obligations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_email text,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_task_assignees TO authenticated;
GRANT ALL ON public.compliance_task_assignees TO service_role;
ALTER TABLE public.compliance_task_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own task assignees" ON public.compliance_task_assignees
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Comments
CREATE TABLE IF NOT EXISTS public.compliance_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.compliance_obligations(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.compliance_comments(id) ON DELETE CASCADE,
  author_name text,
  body text NOT NULL,
  mentions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_comments TO authenticated;
GRANT ALL ON public.compliance_comments TO service_role;
ALTER TABLE public.compliance_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own compliance comments" ON public.compliance_comments
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER set_compliance_comments_updated_at BEFORE UPDATE ON public.compliance_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Activity log
CREATE TABLE IF NOT EXISTS public.compliance_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  obligation_id uuid REFERENCES public.compliance_obligations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail text,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.compliance_activity_log TO authenticated;
GRANT ALL ON public.compliance_activity_log TO service_role;
ALTER TABLE public.compliance_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their own compliance activity" ON public.compliance_activity_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users log their own compliance activity" ON public.compliance_activity_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Contract team members
CREATE TABLE IF NOT EXISTS public.compliance_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_name text NOT NULL,
  member_email text NOT NULL,
  member_role text NOT NULL DEFAULT 'contributor',
  invited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_team_members TO authenticated;
GRANT ALL ON public.compliance_team_members TO service_role;
ALTER TABLE public.compliance_team_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage their own contract team" ON public.compliance_team_members
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS compliance_comments_obligation_idx ON public.compliance_comments (obligation_id, created_at);
CREATE INDEX IF NOT EXISTS compliance_activity_obligation_idx ON public.compliance_activity_log (obligation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_assignees_obligation_idx ON public.compliance_task_assignees (obligation_id);