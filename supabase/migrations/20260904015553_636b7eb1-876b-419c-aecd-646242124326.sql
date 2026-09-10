ALTER TABLE public.compliance_contracts
  ADD COLUMN IF NOT EXISTS raw_extraction JSONB,
  ADD COLUMN IF NOT EXISTS raw_extraction_saved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_model TEXT;

ALTER TABLE public.compliance_obligations
  ADD COLUMN IF NOT EXISTS extraction_source TEXT NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS user_review_action TEXT,
  ADD COLUMN IF NOT EXISTS original_ai_text TEXT,
  ADD COLUMN IF NOT EXISTS original_ai_due_date DATE,
  ADD COLUMN IF NOT EXISTS extraction_index INTEGER;

CREATE TABLE IF NOT EXISTS public.compliance_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.compliance_contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  model TEXT,
  source_label TEXT,
  is_original BOOLEAN NOT NULL DEFAULT false,
  extraction JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_extraction_runs TO authenticated;
GRANT ALL ON public.compliance_extraction_runs TO service_role;

ALTER TABLE public.compliance_extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their extraction runs"
ON public.compliance_extraction_runs FOR ALL TO authenticated
USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER compliance_extraction_runs_updated_at
BEFORE UPDATE ON public.compliance_extraction_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS compliance_extraction_runs_contract_idx
  ON public.compliance_extraction_runs (contract_id, created_at DESC);