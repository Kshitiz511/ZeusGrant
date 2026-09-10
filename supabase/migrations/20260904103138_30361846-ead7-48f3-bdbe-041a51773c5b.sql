
CREATE TABLE public.website_scrape_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  pages_scraped TEXT[] NOT NULL DEFAULT '{}',
  total_data_points_extracted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'complete',
  raw_extraction JSONB,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.website_scrape_sessions TO authenticated;
GRANT ALL ON public.website_scrape_sessions TO service_role;
ALTER TABLE public.website_scrape_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scrape sessions" ON public.website_scrape_sessions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.profile_source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT,
  file_size INTEGER,
  funder_name TEXT,
  opportunity_title TEXT,
  submission_date DATE,
  award_amount NUMERIC,
  award_status TEXT DEFAULT 'unknown',
  program_area TEXT,
  notes TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  extraction_completed_at TIMESTAMPTZ,
  extracted_count INTEGER NOT NULL DEFAULT 0,
  times_referenced INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_source_documents TO authenticated;
GRANT ALL ON public.profile_source_documents TO service_role;
ALTER TABLE public.profile_source_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own source documents" ON public.profile_source_documents FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.proposal_content_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_document_id UUID REFERENCES public.profile_source_documents ON DELETE SET NULL,
  block_type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  funder_type TEXT,
  program_area TEXT,
  award_status TEXT DEFAULT 'unknown',
  tone TEXT,
  times_used INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposal_content_library TO authenticated;
GRANT ALL ON public.proposal_content_library TO service_role;
ALTER TABLE public.proposal_content_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own content library" ON public.proposal_content_library FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.impact_statistics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_document_id UUID REFERENCES public.profile_source_documents ON DELETE SET NULL,
  stat_text TEXT NOT NULL,
  numeric_value NUMERIC,
  unit TEXT,
  program_area TEXT,
  time_period TEXT,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.impact_statistics TO authenticated;
GRANT ALL ON public.impact_statistics TO service_role;
ALTER TABLE public.impact_statistics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own impact statistics" ON public.impact_statistics FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.person_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  source_document_id UUID REFERENCES public.profile_source_documents ON DELETE SET NULL,
  person_type TEXT NOT NULL DEFAULT 'staff',
  teaming_org_name TEXT,
  full_name TEXT NOT NULL,
  title TEXT,
  role_on_proposals TEXT[] NOT NULL DEFAULT '{}',
  education JSONB NOT NULL DEFAULT '[]'::jsonb,
  certifications TEXT[] NOT NULL DEFAULT '{}',
  years_of_experience INTEGER,
  areas_of_expertise TEXT[] NOT NULL DEFAULT '{}',
  relevant_skills TEXT[] NOT NULL DEFAULT '{}',
  languages TEXT[] NOT NULL DEFAULT '{}',
  selected_projects JSONB NOT NULL DEFAULT '[]'::jsonb,
  publications TEXT[] NOT NULL DEFAULT '{}',
  awards TEXT[] NOT NULL DEFAULT '{}',
  ai_generated_bio_short TEXT,
  ai_generated_bio_long TEXT,
  confidence TEXT DEFAULT 'medium',
  times_included_in_proposals INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.person_profiles TO authenticated;
GRANT ALL ON public.person_profiles TO service_role;
ALTER TABLE public.person_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own person profiles" ON public.person_profiles FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.org_profile_data_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  category TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_value TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_document_id UUID REFERENCES public.profile_source_documents ON DELETE SET NULL,
  source_scrape_session_id UUID REFERENCES public.website_scrape_sessions ON DELETE SET NULL,
  source_label TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  times_used_in_proposals INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_profile_data_points TO authenticated;
GRANT ALL ON public.org_profile_data_points TO service_role;
ALTER TABLE public.org_profile_data_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile data points" ON public.org_profile_data_points FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TRIGGER psd_updated_at BEFORE UPDATE ON public.profile_source_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER pp_updated_at BEFORE UPDATE ON public.person_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER opdp_updated_at BEFORE UPDATE ON public.org_profile_data_points
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_profiles
  ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS capability_summary TEXT,
  ADD COLUMN IF NOT EXISTS naics_codes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS certifications TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS uei TEXT,
  ADD COLUMN IF NOT EXISTS sam_registered BOOLEAN,
  ADD COLUMN IF NOT EXISTS contract_vehicles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS core_competencies TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS differentiators TEXT[] NOT NULL DEFAULT '{}';
