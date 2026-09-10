-- CONTRACTS
CREATE TABLE public.compliance_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grant_record_id uuid REFERENCES public.grant_records(id) ON DELETE SET NULL,
  name text NOT NULL,
  funder text NOT NULL DEFAULT '',
  contract_number text,
  award_amount numeric,
  period_start date,
  period_end date,
  compensation_type text NOT NULL DEFAULT 'lump_sum',
  lump_sum_amount numeric,
  reimbursable_cap numeric,
  reimbursable_multiplier numeric,
  invoicing_basis text,
  storage_path text,
  file_name text,
  mime_type text,
  size_bytes integer,
  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  extraction_summary text,
  status text NOT NULL DEFAULT 'active',
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_contracts TO authenticated;
GRANT ALL ON public.compliance_contracts TO service_role;
ALTER TABLE public.compliance_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own contracts" ON public.compliance_contracts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_contracts_updated_at BEFORE UPDATE ON public.compliance_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_contracts_user_idx ON public.compliance_contracts(user_id);

-- OBLIGATIONS
CREATE TABLE public.compliance_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL DEFAULT 'administrative',
  title text NOT NULL,
  description text,
  due_date date,
  recurrence text NOT NULL DEFAULT 'one_time',
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'not_started',
  assignee_name text,
  assignee_email text,
  prior_approval_required boolean NOT NULL DEFAULT false,
  amount numeric,
  percent_complete integer NOT NULL DEFAULT 0,
  source_quote text,
  source_page integer,
  confidence numeric,
  confirmed boolean NOT NULL DEFAULT false,
  completion_notes text,
  completed_at timestamptz,
  snoozed_until date,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_obligations TO authenticated;
GRANT ALL ON public.compliance_obligations TO service_role;
ALTER TABLE public.compliance_obligations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own obligations" ON public.compliance_obligations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_obligations_updated_at BEFORE UPDATE ON public.compliance_obligations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_obligations_contract_idx ON public.compliance_obligations(contract_id);

-- BUDGET CATEGORIES
CREATE TABLE public.compliance_budget_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_type text NOT NULL DEFAULT 'direct',
  budgeted_amount numeric NOT NULL DEFAULT 0,
  spent_amount numeric NOT NULL DEFAULT 0,
  cap_amount numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_budget_categories TO authenticated;
GRANT ALL ON public.compliance_budget_categories TO service_role;
ALTER TABLE public.compliance_budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own budget categories" ON public.compliance_budget_categories FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_budget_categories_updated_at BEFORE UPDATE ON public.compliance_budget_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_budget_contract_idx ON public.compliance_budget_categories(contract_id);

-- RATE CARDS
CREATE TABLE public.compliance_rate_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  labor_category text NOT NULL,
  level text,
  hourly_rate numeric NOT NULL,
  effective_through date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_rate_cards TO authenticated;
GRANT ALL ON public.compliance_rate_cards TO service_role;
ALTER TABLE public.compliance_rate_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own rate cards" ON public.compliance_rate_cards FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_rate_cards_updated_at BEFORE UPDATE ON public.compliance_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_rate_cards_contract_idx ON public.compliance_rate_cards(contract_id);

-- INVOICES
CREATE TABLE public.compliance_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_number text,
  period_start date,
  period_end date,
  percent_complete integer NOT NULL DEFAULT 0,
  fee_amount numeric NOT NULL DEFAULT 0,
  reimbursables_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  issued_date date,
  paid_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_invoices TO authenticated;
GRANT ALL ON public.compliance_invoices TO service_role;
ALTER TABLE public.compliance_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own invoices" ON public.compliance_invoices FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_invoices_updated_at BEFORE UPDATE ON public.compliance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_invoices_contract_idx ON public.compliance_invoices(contract_id);

-- DELIVERABLE PROGRESS
CREATE TABLE public.compliance_deliverable_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id uuid NOT NULL REFERENCES public.compliance_obligations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  percent_complete integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_deliverable_progress TO authenticated;
GRANT ALL ON public.compliance_deliverable_progress TO service_role;
ALTER TABLE public.compliance_deliverable_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own deliverable progress" ON public.compliance_deliverable_progress FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- DOCUMENTS
CREATE TABLE public.compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  obligation_id uuid REFERENCES public.compliance_obligations(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL DEFAULT 'evidence',
  storage_path text NOT NULL,
  size_bytes integer,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_documents TO authenticated;
GRANT ALL ON public.compliance_documents TO service_role;
ALTER TABLE public.compliance_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own compliance documents" ON public.compliance_documents FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER compliance_documents_updated_at BEFORE UPDATE ON public.compliance_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX compliance_documents_contract_idx ON public.compliance_documents(contract_id);