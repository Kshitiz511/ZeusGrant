CREATE TABLE public.opportunities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  funder TEXT NOT NULL,
  funder_type TEXT NOT NULL DEFAULT 'federal',
  summary TEXT NOT NULL,
  focus_areas TEXT[] NOT NULL DEFAULT '{}',
  eligible_org_types TEXT[] NOT NULL DEFAULT '{}',
  populations_served TEXT[] NOT NULL DEFAULT '{}',
  award_min NUMERIC,
  award_max NUMERIC,
  deadline DATE,
  eligible_states TEXT[] NOT NULL DEFAULT '{}',
  country TEXT NOT NULL DEFAULT 'United States',
  match_required BOOLEAN NOT NULL DEFAULT false,
  application_url TEXT,
  source TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.opportunities TO anon;
GRANT SELECT ON public.opportunities TO authenticated;
GRANT ALL ON public.opportunities TO service_role;

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active opportunities"
  ON public.opportunities FOR SELECT
  USING (is_active = true);

CREATE TRIGGER opportunities_set_updated_at
  BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.opportunities (slug, title, funder, funder_type, summary, focus_areas, eligible_org_types, populations_served, award_min, award_max, deadline, eligible_states, match_required, application_url, source) VALUES
('community-facilities-grant','Community Facilities Direct Loan & Grant Program','USDA Rural Development','federal','Funds essential community facilities such as health clinics, childcare centers and libraries in rural communities.','{"community development","health","education"}','{"nonprofit","government","tribal"}','{"rural communities","low-income"}',10000,500000,'2026-11-30','{}',true,'https://www.grants.gov','Grants.gov'),
('sbir-phase-i','Small Business Innovation Research (SBIR) Phase I','National Science Foundation','federal','Seed funding for deep-technology small businesses to establish technical feasibility of an innovation.','{"technology","research","innovation"}','{"small business","for-profit"}','{}',50000,305000,'2026-10-15','{}',false,'https://seedfund.nsf.gov','NSF'),
('workforce-innovation-fund','Workforce Innovation and Opportunity Grants','U.S. Department of Labor','federal','Supports job training, apprenticeship and reentry employment programs for underserved workers.','{"workforce development","education","economic development"}','{"nonprofit","government","education"}','{"unemployed","youth","justice-involved"}',250000,2000000,'2026-12-12','{}',true,'https://www.dol.gov/grants','DOL'),
('youth-mentoring-initiative','National Youth Mentoring Initiative','Office of Juvenile Justice and Delinquency Prevention','federal','Expands evidence-based mentoring services for at-risk youth and their families.','{"youth development","education","community development"}','{"nonprofit","tribal"}','{"youth","at-risk youth"}',100000,750000,'2026-09-30','{}',false,'https://ojjdp.ojp.gov/funding','OJJDP'),
('health-equity-innovation','Health Equity Innovation Awards','Robert Wood Johnson Foundation','foundation','Supports community-led projects that reduce health disparities and improve access to care.','{"health","health equity","community development"}','{"nonprofit","education","government"}','{"low-income","communities of color","rural communities"}',75000,500000,'2026-10-01','{}',false,'https://www.rwjf.org/en/grants','RWJF'),
('arts-project-grant','Grants for Arts Projects','National Endowment for the Arts','federal','Project-based support for arts programming, artist residencies and cultural preservation.','{"arts","culture","education"}','{"nonprofit","education","government","tribal"}','{"general public","students"}',10000,100000,'2026-11-05','{}',true,'https://www.arts.gov/grants','NEA'),
('food-security-partnership','Community Food Projects Competitive Grant','USDA NIFA','federal','Builds long-term food security through local food systems, urban agriculture and nutrition programs.','{"food security","agriculture","health"}','{"nonprofit","tribal","education"}','{"food insecure","low-income"}',50000,400000,'2026-12-01','{}',true,'https://www.nifa.usda.gov','USDA NIFA'),
('digital-inclusion-fund','Digital Inclusion and Broadband Adoption Fund','National Telecommunications and Information Administration','federal','Funds digital literacy training, device access and broadband adoption programs.','{"technology","education","community development"}','{"nonprofit","government","education","tribal"}','{"seniors","low-income","rural communities"}',100000,1500000,'2026-10-20','{}',false,'https://broadbandusa.ntia.gov','NTIA'),
('women-owned-business-accelerator','Women-Owned Small Business Growth Grants','U.S. Small Business Administration','federal','Capacity-building funds for accelerators serving women entrepreneurs and small businesses.','{"economic development","entrepreneurship","workforce development"}','{"small business","nonprofit","for-profit"}','{"women","entrepreneurs"}',25000,150000,'2026-09-15','{}',false,'https://www.sba.gov/funding-programs','SBA'),
('climate-resilience-communities','Community Climate Resilience Grants','Environmental Protection Agency','federal','Supports local climate adaptation planning, green infrastructure and environmental justice work.','{"environment","climate","community development"}','{"nonprofit","government","tribal","education"}','{"low-income","communities of color"}',150000,1000000,'2026-11-14','{}',false,'https://www.epa.gov/grants','EPA'),
('education-innovation-research','Education Innovation and Research (EIR) Program','U.S. Department of Education','federal','Funds development and scaling of evidence-based educational interventions for high-need students.','{"education","research","youth development"}','{"education","nonprofit","government"}','{"students","low-income"}',400000,4000000,'2026-10-28','{}',true,'https://www.ed.gov/grants','ED'),
('texas-nonprofit-capacity','Texas Nonprofit Capacity Building Grants','Texas Health and Human Services','state','Operating and capacity support for Texas-based nonprofits delivering direct human services.','{"health","human services","community development"}','{"nonprofit"}','{"low-income","families"}',15000,100000,'2026-09-25','{"TX"}',false,'https://www.hhs.texas.gov','Texas HHS'),
('california-community-resilience','California Community Resilience Centers Program','California Strategic Growth Council','state','Builds and upgrades community centers serving as resilience hubs during climate emergencies.','{"environment","community development","health"}','{"nonprofit","government","tribal"}','{"low-income","communities of color"}',200000,10000000,'2026-12-18','{"CA"}',false,'https://sgc.ca.gov','CA SGC'),
('local-impact-fund','Local Impact Fund','Bank of America Charitable Foundation','corporate','Flexible grants for nonprofits advancing economic mobility through housing, jobs and basic needs.','{"economic development","housing","workforce development"}','{"nonprofit"}','{"low-income","families","unhoused"}',25000,200000,'2026-10-09','{}',false,'https://about.bankofamerica.com/en/making-an-impact','Bank of America');