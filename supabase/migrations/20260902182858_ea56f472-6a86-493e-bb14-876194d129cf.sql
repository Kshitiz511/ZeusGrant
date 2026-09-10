
CREATE TABLE public.funding_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name text NOT NULL,
  organization_name text NOT NULL,
  organization_type text NOT NULL DEFAULT 'government',
  source_level text NOT NULL DEFAULT 'Federal',
  country text NOT NULL DEFAULT 'United States',
  region text,
  state text,
  states_served text[] NOT NULL DEFAULT '{}',
  county text,
  counties_served text[] NOT NULL DEFAULT '{}',
  city text,
  cities_served text[] NOT NULL DEFAULT '{}',
  nationwide boolean NOT NULL DEFAULT false,
  geographic_coverage_description text,
  website text,
  funding_page text,
  api_available boolean NOT NULL DEFAULT false,
  api_endpoint text,
  api_documentation text,
  authentication_type text,
  api_key_required boolean NOT NULL DEFAULT false,
  structured_feed_available boolean NOT NULL DEFAULT false,
  feed_type text,
  feed_url text,
  crawler_available boolean NOT NULL DEFAULT false,
  robots_status text,
  crawl_frequency text,
  search_terms text[] NOT NULL DEFAULT '{}',
  last_sync timestamptz,
  last_successful_sync timestamptz,
  next_crawl timestamptz,
  source_priority integer NOT NULL DEFAULT 4 CHECK (source_priority BETWEEN 1 AND 6),
  source_reliability integer NOT NULL DEFAULT 50 CHECK (source_reliability BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  error_status text,
  opportunities_found integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.funding_sources TO authenticated;
GRANT ALL ON public.funding_sources TO service_role;
ALTER TABLE public.funding_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read funding sources"
  ON public.funding_sources FOR SELECT TO authenticated USING (true);

CREATE TRIGGER set_funding_sources_updated_at
  BEFORE UPDATE ON public.funding_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.org_profiles
  ADD COLUMN operating_states text[] NOT NULL DEFAULT '{}',
  ADD COLUMN counties_served text[] NOT NULL DEFAULT '{}',
  ADD COLUMN service_area_scope text,
  ADD COLUMN target_expansion_markets text[] NOT NULL DEFAULT '{}',
  ADD COLUMN project_location_flexibility text,
  ADD COLUMN relocation_willingness text,
  ADD COLUMN geographic_scope_preference text NOT NULL DEFAULT 'Anywhere I am eligible';

ALTER TABLE public.opportunities
  ADD COLUMN source_id uuid REFERENCES public.funding_sources(id) ON DELETE SET NULL,
  ADD COLUMN geo_level text NOT NULL DEFAULT 'national',
  ADD COLUMN region text,
  ADD COLUMN eligible_counties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN eligible_cities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN opportunity_type text NOT NULL DEFAULT 'grant',
  ADD COLUMN is_forecasted boolean NOT NULL DEFAULT false,
  ADD COLUMN project_location_required boolean NOT NULL DEFAULT false,
  ADD COLUMN headquarters_location_required boolean NOT NULL DEFAULT false,
  ADD COLUMN verified_at timestamptz,
  ADD COLUMN source_reliability integer NOT NULL DEFAULT 95;

INSERT INTO public.funding_sources
  (source_name, organization_name, organization_type, source_level, nationwide, state, states_served, county, city, region,
   geographic_coverage_description, website, funding_page, api_available, api_endpoint, structured_feed_available, feed_type,
   crawler_available, crawl_frequency, source_priority, source_reliability, notes)
VALUES
  ('Grants.gov Search API','U.S. General Services Administration','government','Federal',true,NULL,'{}',NULL,NULL,NULL,
   'All U.S. states and territories','https://www.grants.gov','https://www.grants.gov/search-grants',true,'https://api.grants.gov/v1/api/search2',true,'JSON',false,'daily',1,100,'Open and forecasted federal opportunities.'),
  ('Simpler.Grants.gov API','U.S. General Services Administration','government','Federal',true,NULL,'{}',NULL,NULL,NULL,
   'All U.S. states and territories','https://simpler.grants.gov','https://simpler.grants.gov/opportunities',true,'https://api.simpler.grants.gov/v1/opportunities/search',true,'JSON',false,'daily',1,100,'Modernized federal opportunity API.'),
  ('SBIR/STTR Solicitations','U.S. Small Business Administration','government','Federal',true,NULL,'{}',NULL,NULL,NULL,
   'Nationwide small business R&D','https://www.sbir.gov','https://www.sbir.gov/solicitations',true,'https://api.www.sbir.gov/public/api/solicitations',true,'JSON',false,'daily',1,100,'America''s Seed Fund solicitations.'),
  ('SAM.gov Assistance Listings','U.S. General Services Administration','government','Federal',true,NULL,'{}',NULL,NULL,NULL,
   'Federal assistance listing catalogue','https://sam.gov','https://sam.gov/content/assistance-listings',true,'https://api.sam.gov/prod/federalorganizations/v1',true,'JSON',false,'weekly',1,100,'Assistance Listing (CFDA) reference data.'),
  ('Florida Department of Economic Opportunity','State of Florida','government','State',false,'FL','{FL}',NULL,NULL,'Southeast',
   'Statewide Florida programs','https://www.floridajobs.org','https://www.floridajobs.org/business-growth-and-partnerships',false,NULL,false,NULL,true,'weekly',4,98,'State connector: FloridaConnector.'),
  ('Georgia Department of Economic Development','State of Georgia','government','State',false,'GA','{GA}',NULL,NULL,'Southeast',
   'Statewide Georgia programs','https://www.georgia.org','https://www.georgia.org/incentives',false,NULL,false,NULL,true,'weekly',4,98,'State connector: GeorgiaConnector.'),
  ('Texas Economic Development','State of Texas','government','State',false,'TX','{TX}',NULL,NULL,'Southwest',
   'Statewide Texas programs','https://gov.texas.gov','https://gov.texas.gov/business/page/incentives',false,NULL,false,NULL,true,'weekly',4,98,'State connector: TexasConnector.'),
  ('Palm Beach County Community Services','Palm Beach County, Florida','government','County',false,'FL','{FL}','Palm Beach',NULL,'Southeast',
   'Palm Beach County, Florida','https://discover.pbcgov.org','https://discover.pbcgov.org/communityservices',false,NULL,false,NULL,true,'monthly',4,98,'County connector.'),
  ('City of West Palm Beach Economic Development','City of West Palm Beach','government','City',false,'FL','{FL}','Palm Beach','West Palm Beach','Southeast',
   'City of West Palm Beach, Florida','https://www.wpb.org','https://www.wpb.org/departments/economic-development',false,NULL,false,NULL,true,'monthly',4,98,'City connector.'),
  ('Candid Foundation Directory','Candid','nonprofit','Foundation',true,NULL,'{}',NULL,NULL,NULL,
   'Nationwide foundation and RFP data','https://candid.org','https://candid.org/use-our-data',true,NULL,false,NULL,false,'weekly',3,90,'Schema-ready; activates when an API license is added.'),
  ('Corporate Giving Programs Registry','ZCS GrantMatch Innovation','corporate','Corporate',true,NULL,'{}',NULL,NULL,NULL,
   'Nationwide corporate giving','https://zeusconsulting.com',NULL,false,NULL,false,NULL,true,'monthly',4,85,'Curated corporate philanthropy programs.'),
  ('Administrator Curated Sources','ZCS GrantMatch Innovation','internal','Other',true,NULL,'{}',NULL,NULL,NULL,
   'Manually verified opportunities','https://zeusconsulting.com',NULL,false,NULL,false,NULL,false,'as needed',6,75,'Manually added by administrators.');

UPDATE public.opportunities SET
  geo_level = CASE WHEN cardinality(eligible_states) = 0 THEN 'national' ELSE 'state' END,
  verified_at = now(),
  source_id = CASE
    WHEN funder_type ILIKE '%federal%' THEN (SELECT id FROM public.funding_sources WHERE source_name = 'Grants.gov Search API')
    WHEN funder_type ILIKE '%state%' THEN (SELECT id FROM public.funding_sources WHERE source_name = 'Florida Department of Economic Opportunity')
    WHEN funder_type ILIKE '%corporate%' THEN (SELECT id FROM public.funding_sources WHERE source_name = 'Corporate Giving Programs Registry')
    WHEN funder_type ILIKE '%foundation%' THEN (SELECT id FROM public.funding_sources WHERE source_name = 'Candid Foundation Directory')
    ELSE (SELECT id FROM public.funding_sources WHERE source_name = 'Administrator Curated Sources')
  END,
  source_reliability = CASE
    WHEN funder_type ILIKE '%federal%' THEN 100
    WHEN funder_type ILIKE '%state%' THEN 98
    WHEN funder_type ILIKE '%foundation%' THEN 90
    ELSE 85 END;

INSERT INTO public.opportunities
  (slug, title, funder, funder_type, summary, focus_areas, eligible_org_types, eligible_states, eligible_counties, eligible_cities,
   populations_served, award_min, award_max, deadline, match_required, application_url, source, geo_level, region,
   opportunity_type, is_forecasted, project_location_required, headquarters_location_required, verified_at, source_reliability, source_id)
VALUES
  ('pbc-community-impact-fund','Palm Beach County Community Impact Fund','Palm Beach County Community Services','County',
   'Operating and program support for organizations serving Palm Beach County residents.',
   '{Human services,Housing,Youth development}','{Nonprofit}','{FL}','{Palm Beach}','{}','{Low-income families,Youth}',
   25000,150000, (now() + interval '75 days')::date, false,'https://discover.pbcgov.org/communityservices','Palm Beach County Community Services',
   'county','Southeast','grant',false,true,false, now(), 98,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Palm Beach County Community Services')),
  ('wpb-small-business-boost','West Palm Beach Small Business Boost','City of West Palm Beach','City',
   'Storefront improvement and hiring grants for small businesses inside city limits.',
   '{Economic development,Small business}','{Small business,For-profit}','{FL}','{Palm Beach}','{West Palm Beach}','{Minority-owned businesses}',
   5000,50000, (now() + interval '45 days')::date, true,'https://www.wpb.org/departments/economic-development','City of West Palm Beach',
   'city','Southeast','grant',false,true,true, now(), 98,
   (SELECT id FROM public.funding_sources WHERE source_name = 'City of West Palm Beach Economic Development')),
  ('southeast-rural-resilience','Southeast Rural Resilience Program','Southeast Regional Commission','Regional',
   'Multi-state regional funding for rural infrastructure, broadband and workforce projects.',
   '{Rural development,Workforce,Infrastructure}','{Nonprofit,Government,Small business}','{FL,GA,AL,SC,NC,TN,MS}','{}','{}','{Rural communities}',
   100000,750000, (now() + interval '110 days')::date, true,'https://www.grants.gov/search-grants','Regional commission portal',
   'regional','Southeast','grant',false,true,false, now(), 95,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Grants.gov Search API')),
  ('georgia-jobs-expansion-credit','Georgia Job Tax Credit — Expansion Track','Georgia Department of Economic Development','State',
   'Tax credits for companies establishing or expanding operations in Georgia before the award date.',
   '{Economic development,Job creation}','{Small business,For-profit}','{GA}','{}','{}','{}',
   50000,500000, (now() + interval '160 days')::date, false,'https://www.georgia.org/incentives','Georgia Department of Economic Development',
   'state','Southeast','tax incentive',false,true,false, now(), 98,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Georgia Department of Economic Development')),
  ('texas-enterprise-relocation-fund','Texas Enterprise Fund — Relocation Track','Texas Economic Development','State',
   'Deal-closing incentive for employers relocating or expanding operations into Texas.',
   '{Economic development,Job creation}','{For-profit,Small business}','{TX}','{}','{}','{}',
   250000,2000000, (now() + interval '190 days')::date, true,'https://gov.texas.gov/business/page/incentives','Texas Economic Development',
   'state','Southwest','incentive',false,true,true, now(), 98,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Texas Economic Development')),
  ('sbir-phase-i-forecast','SBIR Phase I — Forecasted Fall Solicitation','U.S. Small Business Administration','Federal',
   'Forecasted federal R&D solicitation. Prepare now; the open period has not started yet.',
   '{Research,Technology,Innovation}','{Small business,Startup}','{}','{}','{}','{}',
   50000,300000, (now() + interval '210 days')::date, false,'https://www.sbir.gov/solicitations','SBIR.gov',
   'national',NULL,'grant',true,false,false, now(), 100,
   (SELECT id FROM public.funding_sources WHERE source_name = 'SBIR/STTR Solicitations')),
  ('community-lender-forgivable-loan','Community Lender Forgivable Loan Program','Southeast Community Bank Consortium','Bank',
   'Forgivable loan — not a grant — for job-creating small businesses in qualifying communities.',
   '{Small business,Economic development}','{Small business,For-profit}','{FL,GA}','{}','{}','{Minority-owned businesses}',
   25000,250000, (now() + interval '95 days')::date, false,'https://www.grants.gov/search-grants','Bank consortium portal',
   'regional','Southeast','forgivable loan',false,false,true, now(), 85,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Administrator Curated Sources')),
  ('national-foundation-capacity','National Capacity Building Initiative','Candid-listed National Foundation','Foundation',
   'Unrestricted capacity building support open to eligible nonprofits nationwide.',
   '{Capacity building,Organizational development}','{Nonprofit}','{}','{}','{}','{}',
   20000,100000, (now() + interval '130 days')::date, false,'https://candid.org','Candid Foundation Directory',
   'national',NULL,'grant',false,false,false, now(), 90,
   (SELECT id FROM public.funding_sources WHERE source_name = 'Candid Foundation Directory'));

UPDATE public.funding_sources fs
SET opportunities_found = sub.c, last_successful_sync = now(), last_sync = now()
FROM (SELECT source_id, count(*) c FROM public.opportunities GROUP BY source_id) sub
WHERE sub.source_id = fs.id;
