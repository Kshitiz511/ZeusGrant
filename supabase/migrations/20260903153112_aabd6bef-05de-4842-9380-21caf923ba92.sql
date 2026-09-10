
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS export_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS templates_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_level text NOT NULL DEFAULT 'basic';

UPDATE public.plan_limits SET export_enabled = true, compliance_level = 'full' WHERE plan_id IN ('growth');
UPDATE public.plan_limits SET export_enabled = true, templates_enabled = true, compliance_level = 'full_ai' WHERE plan_id IN ('professional','agency');

CREATE TABLE IF NOT EXISTS public.proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL,
  opportunity_slug text NOT NULL,
  opportunity_title text NOT NULL,
  funder text NOT NULL,
  deadline date,
  match_score integer,
  status text NOT NULL DEFAULT 'in_progress',
  eligibility_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  interview_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
  interview_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  interview_position integer NOT NULL DEFAULT 0,
  draft_content jsonb NOT NULL DEFAULT '[]'::jsonb,
  completeness_score integer NOT NULL DEFAULT 0,
  compliance_review_results jsonb,
  version_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived boolean NOT NULL DEFAULT false,
  downloaded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposals TO authenticated;
GRANT ALL ON public.proposals TO service_role;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposals_all_own ON public.proposals FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER proposals_set_updated_at BEFORE UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS proposals_user_idx ON public.proposals(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.proposal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  source_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  interview_answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_content jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proposal_templates TO authenticated;
GRANT ALL ON public.proposal_templates TO service_role;
ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY proposal_templates_all_own ON public.proposal_templates FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER proposal_templates_set_updated_at BEFORE UPDATE ON public.proposal_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

UPDATE public.opportunities SET application_url = v.url FROM (VALUES
  ('community-facilities-grant','https://www.rd.usda.gov/programs-services/community-facilities/community-facilities-direct-loan-grant-program'),
  ('food-security-partnership','https://www.nifa.usda.gov/grants/programs/community-food-projects-competitive-grant-program'),
  ('education-innovation-research','https://www.ed.gov/grants-and-programs/grants-birth-grade-12/education-innovation-and-research-eir'),
  ('workforce-innovation-fund','https://www.dol.gov/agencies/eta/grants/apply/find-opportunities'),
  ('women-owned-business-accelerator','https://www.sba.gov/about-sba/sba-locations/headquarters-offices/office-womens-business-ownership'),
  ('sbir-phase-i','https://seedfund.nsf.gov/apply/'),
  ('sbir-phase-i-forecast','https://www.sbir.gov/solicitations'),
  ('arts-project-grant','https://www.arts.gov/grants/grants-for-arts-projects'),
  ('climate-resilience-communities','https://www.epa.gov/environmentaljustice/environmental-justice-grants-and-resources'),
  ('youth-mentoring-initiative','https://ojjdp.ojp.gov/funding/opportunities'),
  ('digital-inclusion-fund','https://broadbandusa.ntia.gov/funding-programs/digital-equity-act-programs'),
  ('health-equity-innovation','https://www.rwjf.org/en/grants/funding-opportunities.html'),
  ('national-foundation-capacity','https://candid.org/find-funding'),
  ('local-impact-fund','https://about.bankofamerica.com/en/making-an-impact/charitable-foundation-funding'),
  ('california-community-resilience','https://sgc.ca.gov/grant-programs/'),
  ('georgia-jobs-expansion-credit','https://www.georgia.org/competitive-advantages/incentives'),
  ('texas-enterprise-relocation-fund','https://gov.texas.gov/business/page/texas-enterprise-fund'),
  ('texas-nonprofit-capacity','https://www.hhs.texas.gov/doing-business-hhs/grants'),
  ('southeast-rural-resilience','https://www.grants.gov/search-grants?keywords=rural%20resilience'),
  ('community-lender-forgivable-loan','https://www.cdfifund.gov/programs'),
  ('pbc-community-impact-fund','https://discover.pbcgov.org/communityservices/Pages/Financially-Assisted-Agencies.aspx'),
  ('wpb-small-business-boost','https://www.wpb.org/government/community-redevelopment-agency/grants')
) AS v(slug, url) WHERE opportunities.slug = v.slug;
