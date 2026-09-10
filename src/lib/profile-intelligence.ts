export type Confidence = "high" | "medium" | "low";

export type ScrapedProfile = {
  org_name: string | null;
  dba_name: string | null;
  org_type: string | null;
  mission: string | null;
  vision: string | null;
  year_founded: number | null;
  service_area: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  social_links: string[];
  programs: { name: string; description: string }[];
  populations_served: string[];
  focus_areas: string[];
  geographic_reach: string | null;
  staff_count: number | null;
  volunteer_count: number | null;
  leadership: { name: string; title: string }[];
  partners: string[];
  board_members: string[];
  accreditations: string[];
  awards: string[];
  annual_budget: number | null;
  funding_sources: string[];
  grant_awards: string[];
  testimonials: string[];
  impact_statistics: {
    stat_text: string;
    numeric_value: number | null;
    unit: string | null;
    time_period: string | null;
  }[];
  case_studies: string[];
  media_mentions: string[];
  data_points: {
    category: string;
    field_name: string;
    field_value: string;
    confidence: string;
    source_page: string;
  }[];
};

export type ExtractedPerson = {
  full_name: string;
  title: string | null;
  role_on_proposals: string[];
  education: { degree: string; field: string; institution: string; year: string | null }[];
  certifications: string[];
  years_of_experience: number | null;
  areas_of_expertise: string[];
  relevant_skills: string[];
  languages: string[];
  selected_projects: {
    title: string;
    client: string | null;
    year: string | null;
    role: string | null;
    description: string;
    dollar_value: number | null;
  }[];
  publications: string[];
  awards: string[];
  teaming_org_name: string | null;
  bio_short: string;
  bio_long: string;
  confidence: Confidence;
};

export type ExtractedCapability = {
  org_name: string | null;
  uei: string | null;
  duns: string | null;
  cage: string | null;
  sam_registered: boolean | null;
  naics_codes: string[];
  psc_codes: string[];
  certifications: string[];
  contract_vehicles: string[];
  core_competencies: string[];
  differentiators: string[];
  past_performance_summary: string | null;
  data_points: { category: string; field_name: string; field_value: string; confidence: string }[];
};

export type ExtractedPriorProposal = {
  funder_name: string | null;
  opportunity_title: string | null;
  program_area: string | null;
  funder_type: string | null;
  award_amount: number | null;
  award_year: string | null;
  blocks: { block_type: string; title: string; content: string; tone: string }[];
  impact_statistics: {
    stat_text: string;
    numeric_value: number | null;
    unit: string | null;
    program_area: string | null;
    time_period: string | null;
  }[];
  key_personnel: { name: string; role: string }[];
  partners: { name: string; role: string }[];
};

export const DOCUMENT_TYPES = [
  { value: "resume_staff", label: "Staff resume / CV" },
  { value: "resume_teaming", label: "Teaming partner resume" },
  { value: "capability_statement", label: "Capability statement" },
  { value: "prior_proposal", label: "Proposal submitted" },
  { value: "award_notice", label: "Award notice / grant agreement" },
  { value: "solicitation", label: "RFP / solicitation" },
  { value: "past_performance", label: "Past performance write-up" },
  { value: "other", label: "Other" },
] as const;

export const DOCUMENT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  DOCUMENT_TYPES.map((d) => [d.value, d.label]),
);

export const AWARD_STATUSES = [
  { value: "awarded", label: "Awarded" },
  { value: "not_awarded", label: "Not awarded" },
  { value: "pending", label: "Pending" },
  { value: "unknown", label: "Unknown" },
] as const;

export const BLOCK_TYPE_LABEL: Record<string, string> = {
  executive_summary: "Executive summary",
  org_background: "Organizational background",
  mission: "Mission statement",
  problem_statement: "Problem statement",
  program_description: "Program description",
  theory_of_change: "Theory of change",
  evaluation_plan: "Evaluation plan",
  sustainability_plan: "Sustainability plan",
  budget_narrative: "Budget narrative",
  certifications: "Certifications & compliance",
  partnerships: "Partnerships",
  community_engagement: "Community engagement",
  dei: "Diversity, equity & inclusion",
  past_performance: "Past performance",
  other: "Other",
};

export const PROFILE_CATEGORIES = [
  { value: "identity", label: "Organization identity" },
  { value: "certifications", label: "Certifications & designations" },
  { value: "programs", label: "Programs & services" },
  { value: "geography", label: "Geographic service area" },
  { value: "population", label: "Population served" },
  { value: "capacity", label: "Organizational capacity" },
  { value: "financial", label: "Financial profile" },
  { value: "past_performance", label: "Past performance" },
] as const;

export const SOURCE_BADGE: Record<string, { label: string; icon: string }> = {
  website: { label: "Website", icon: "🌐" },
  resume: { label: "Resume", icon: "📄" },
  capability_statement: { label: "Capability statement", icon: "📑" },
  prior_proposal: { label: "Prior proposal", icon: "📋" },
  manual: { label: "Manual entry", icon: "✏️" },
};

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function normalizeConfidence(value: string | null | undefined): Confidence {
  const v = (value ?? "").toLowerCase();
  if (v.startsWith("h")) return "high";
  if (v.startsWith("l")) return "low";
  return "medium";
}

/**
 * Profile completeness across every intelligence category. Each category is a
 * simple present/absent check so the score is stable and explainable.
 */
export function completeness(input: {
  identity: boolean;
  mission: boolean;
  programs: boolean;
  geography: boolean;
  population: boolean;
  capacity: boolean;
  financial: boolean;
  pastPerformance: boolean;
  impact: boolean;
  team: boolean;
  contentLibrary: boolean;
  website: boolean;
}): { score: number; missing: string[] } {
  const checks: [keyof typeof input, string][] = [
    ["identity", "Add your legal name, type and year founded"],
    ["mission", "Add your mission statement"],
    ["programs", "Add your programs and services"],
    ["geography", "Add the geography you serve"],
    ["population", "Add the populations you serve"],
    ["capacity", "Add staff size and leadership"],
    ["financial", "Add your annual budget or funding sources"],
    ["pastPerformance", "Upload an award notice or prior proposal"],
    ["impact", "Add impact statistics"],
    ["team", "Upload staff resumes"],
    ["contentLibrary", "Upload a prior proposal to build reusable content"],
    ["website", "Scan your website"],
  ];
  const missing = checks.filter(([key]) => !input[key]).map(([, tip]) => tip);
  const score = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { score, missing };
}
