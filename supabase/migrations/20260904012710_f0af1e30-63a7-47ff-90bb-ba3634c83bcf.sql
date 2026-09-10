CREATE TABLE public.org_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  document_type text NOT NULL DEFAULT 'other',
  description text,
  storage_path text NOT NULL,
  size_bytes integer,
  mime_type text,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_documents TO authenticated;
GRANT ALL ON public.org_documents TO service_role;

ALTER TABLE public.org_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own org documents"
ON public.org_documents FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_org_documents_updated_at
BEFORE UPDATE ON public.org_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX org_documents_user_idx ON public.org_documents (user_id, created_at DESC);