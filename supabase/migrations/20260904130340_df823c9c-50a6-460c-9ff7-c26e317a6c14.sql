CREATE TABLE public.module_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL CHECK (module IN ('grant_intelligence','contract_compliance','audit_compliance')),
  plan text NOT NULL,
  price_id text,
  status text NOT NULL DEFAULT 'trialing',
  stripe_subscription_id text,
  stripe_customer_id text,
  annual boolean NOT NULL DEFAULT false,
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_end timestamptz,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module, environment)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.module_subscriptions TO authenticated;
GRANT ALL ON public.module_subscriptions TO service_role;
ALTER TABLE public.module_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own module subscriptions" ON public.module_subscriptions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER module_subscriptions_updated_at BEFORE UPDATE ON public.module_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.evidence_vault_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  obligation_id uuid REFERENCES public.compliance_obligations(id) ON DELETE SET NULL,
  citation_id uuid,
  category text,
  compliance_cycle text,
  document_type text NOT NULL DEFAULT 'Supporting Data',
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes integer,
  file_hash text,
  submission_confirmation text,
  uploaded_by_name text,
  notes text,
  upload_timestamp timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evidence_vault_files TO authenticated;
GRANT ALL ON public.evidence_vault_files TO service_role;
ALTER TABLE public.evidence_vault_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own evidence files" ON public.evidence_vault_files FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.audit_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  recipient_name text,
  recipient_agency text,
  format text NOT NULL DEFAULT 'pdf',
  file_url text,
  storage_path text,
  share_link_token text UNIQUE,
  expires_at timestamptz,
  opened_at timestamptz,
  open_count integer NOT NULL DEFAULT 0,
  snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_packages TO authenticated;
GRANT ALL ON public.audit_packages TO service_role;
ALTER TABLE public.audit_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit packages" ON public.audit_packages FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.regulatory_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  citation text NOT NULL,
  plain_language_summary text,
  official_url text,
  source_quote text,
  reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.regulatory_citations TO authenticated;
GRANT ALL ON public.regulatory_citations TO service_role;
ALTER TABLE public.regulatory_citations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own citations" ON public.regulatory_citations FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER regulatory_citations_updated_at BEFORE UPDATE ON public.regulatory_citations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agency_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  contact_name text,
  contact_email text NOT NULL,
  access_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited',
  expires_at timestamptz,
  last_accessed_at timestamptz,
  access_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_portal_access TO authenticated;
GRANT ALL ON public.agency_portal_access TO service_role;
ALTER TABLE public.agency_portal_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own agency access" ON public.agency_portal_access FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX evidence_vault_files_contract_idx ON public.evidence_vault_files(contract_id);
CREATE INDEX evidence_vault_files_obligation_idx ON public.evidence_vault_files(obligation_id);
CREATE INDEX regulatory_citations_contract_idx ON public.regulatory_citations(contract_id);
CREATE INDEX audit_packages_contract_idx ON public.audit_packages(contract_id);