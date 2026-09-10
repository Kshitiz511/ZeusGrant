import type {
  DataPoint,
  ImpactStat,
  OrgProfile,
  PersonProfile,
  SourceDocument,
  ContentBlock,
  ScrapeSession,
} from "@/hooks/useProfileIntelligence";

export type StrengthTier = "empty" | "minimal" | "basic" | "good" | "strong" | "elite";

export type CategoryScore = {
  key: string;
  label: string;
  weight: number;
  /** 0..1 */
  ratio: number;
  requirement: string;
  missing: string[];
};

export type ProfileStrength = {
  score: number;
  tier: StrengthTier;
  tierLabel: string;
  categories: CategoryScore[];
  topActions: { label: string; tab: string }[];
  milestones: { at: number; label: string; blurb: string; unlocked: boolean }[];
};

export const TIERS: { tier: StrengthTier; min: number; label: string; color: string }[] = [
  { tier: "empty", min: 0, label: "Empty profile", color: "bg-muted-foreground" },
  { tier: "minimal", min: 1, label: "Minimal profile", color: "bg-rose-500" },
  { tier: "basic", min: 40, label: "Basic profile", color: "bg-amber-500" },
  { tier: "good", min: 60, label: "Good profile", color: "bg-primary" },
  { tier: "strong", min: 80, label: "Strong profile", color: "bg-emerald-500" },
  { tier: "elite", min: 100, label: "Elite profile", color: "bg-yellow-500" },
];

export function tierFor(score: number) {
  return [...TIERS].reverse().find((t) => score >= t.min) ?? TIERS[0]!;
}

export const MILESTONES = [
  {
    at: 40,
    label: "Opportunity matching",
    blurb: "Funding matches become available.",
  },
  {
    at: 60,
    label: "Proposal drafting",
    blurb: "Start AI-assisted proposal drafts from any match.",
  },
  {
    at: 75,
    label: "Team recommender",
    blurb: "We suggest the right people for each proposal.",
  },
  {
    at: 90,
    label: "Priority matching",
    blurb: "Higher-confidence scoring and sharper results.",
  },
  { at: 100, label: "Elite profile", blurb: "Verified complete profile badge." },
] as const;

export type StrengthInput = {
  org: OrgProfile | null;
  dataPoints: DataPoint[];
  people: PersonProfile[];
  documents: SourceDocument[];
  blocks: ContentBlock[];
  stats: ImpactStat[];
  scrapes: ScrapeSession[];
  pastPerformanceCount: number;
};

const filled = (v: unknown) =>
  v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0);

/** Weighted profile completeness across the six intelligence categories. */
export function computeStrength(input: StrengthInput): ProfileStrength {
  const { org, dataPoints, people, documents, blocks, stats, scrapes } = input;
  const has = (category: string) => dataPoints.some((d) => d.category === category);
  const point = (name: string) =>
    dataPoints.some((d) => d.field_name.toLowerCase().includes(name.toLowerCase()));

  const identityChecks: [boolean, string][] = [
    [filled(org?.org_name), "Legal organization name"],
    [filled(org?.org_type), "Organization type"],
    [filled(org?.ein) || point("EIN"), "EIN / tax ID"],
    [filled(org?.mission), "Mission statement"],
    [filled(org?.city) && filled(org?.state), "Address / location"],
    [filled(org?.year_founded), "Year founded"],
    [filled(org?.annual_budget), "Annual budget"],
  ];

  const certChecks: [boolean, string][] = [
    [(org?.naics_codes?.length ?? 0) > 0, "At least one NAICS code"],
    [org?.sam_registered !== null && org?.sam_registered !== undefined, "SAM.gov status"],
    [(org?.certifications?.length ?? 0) > 0 || has("certifications"), "Socioeconomic certifications"],
    [(org?.contract_vehicles?.length ?? 0) > 0 || filled(org?.uei), "Contract vehicles or UEI"],
  ];

  const programChecks: [boolean, string][] = [
    [has("programs") || (org?.core_competencies?.length ?? 0) > 0, "Programs and services"],
    [(org?.focus_areas?.length ?? 0) > 0, "Focus areas"],
    [(org?.populations_served?.length ?? 0) > 0 || has("population"), "Target populations"],
    [(org?.operating_states?.length ?? 0) > 0 || has("geography"), "Geographic service area"],
  ];

  const teamChecks: [boolean, string][] = [
    [people.length >= 1, "First staff resume"],
    [people.length >= 2, "Second staff resume"],
    [people.some((p) => (p.areas_of_expertise?.length ?? 0) > 0), "Expertise areas on your team"],
  ];

  const pastChecks: [boolean, string][] = [
    [input.pastPerformanceCount > 0, "One past grant or contract on record"],
    [
      documents.some((d) =>
        ["prior_proposal", "award_notice", "past_performance"].includes(d.document_type),
      ),
      "An award notice or prior proposal",
    ],
    [blocks.length > 0, "Reusable proposal content"],
  ];

  const impactChecks: [boolean, string][] = [
    [stats.length >= 1, "First impact statistic"],
    [stats.length >= 2, "Second impact statistic"],
  ];

  const docChecks: [boolean, string][] = [
    [
      scrapes.length > 0 ||
        documents.some((d) => d.document_type === "capability_statement"),
      "Capability statement or website scan",
    ],
  ];

  const build = (
    key: string,
    label: string,
    weight: number,
    requirement: string,
    checks: [boolean, string][],
  ): CategoryScore => ({
    key,
    label,
    weight,
    requirement,
    ratio: checks.filter(([ok]) => ok).length / checks.length,
    missing: checks.filter(([ok]) => !ok).map(([, m]) => m),
  });

  const categories: CategoryScore[] = [
    build("identity", "Organization identity", 15, "Name, type, EIN, mission, location, founded", identityChecks),
    build("certifications", "Certifications & designations", 15, "NAICS, SAM.gov status, certifications", certChecks),
    build("programs", "Programs & expertise", 20, "Programs, populations, service area", programChecks),
    build("team", "Team", 15, "At least 2 staff profiles with expertise", teamChecks),
    build("past_performance", "Past performance", 15, "At least 1 past grant or contract", pastChecks),
    build("impact", "Impact statistics", 10, "At least 2 quantified impact stats", impactChecks),
    build("documents", "Documents", 10, "Capability statement or website scan", docChecks),
  ];

  const score = Math.round(categories.reduce((sum, c) => sum + c.weight * c.ratio, 0));
  const tier = tierFor(score);

  const TAB_FOR: Record<string, string> = {
    identity: "intelligence",
    certifications: "team",
    programs: "website",
    team: "team",
    past_performance: "past",
    impact: "past",
    documents: "website",
  };

  const topActions = categories
    .filter((c) => c.missing.length)
    .sort((a, b) => b.weight * (1 - b.ratio) - a.weight * (1 - a.ratio))
    .slice(0, 3)
    .map((c) => ({ label: c.missing[0]!, tab: TAB_FOR[c.key] ?? "intelligence" }));

  return {
    score,
    tier: tier.tier,
    tierLabel: tier.label,
    categories,
    topActions,
    milestones: MILESTONES.map((m) => ({ ...m, unlocked: score >= m.at })),
  };
}

export type ReadinessRow = {
  category: string;
  status: "ready" | "partial" | "not_ready";
  detail: string;
  fixTab?: string;
};

/** Which families of funding the current profile can realistically pursue. */
export function readinessMap(input: StrengthInput): ReadinessRow[] {
  const { org, people, stats } = input;
  const rows: ReadinessRow[] = [];
  const nonprofit = (org?.org_type ?? "").toLowerCase().includes("nonprofit");
  const forProfit = (org?.org_type ?? "").toLowerCase().includes("profit") && !nonprofit;

  rows.push({
    category: "Private foundation grants",
    status: org?.mission && stats.length > 0 ? "ready" : org?.mission ? "partial" : "not_ready",
    detail:
      org?.mission && stats.length > 0
        ? "Mission and impact evidence on file"
        : "Add quantified impact statistics",
    fixTab: "past",
  });
  rows.push({
    category: "Federal grants (Grants.gov)",
    status: org?.sam_registered ? "ready" : "partial",
    detail: org?.sam_registered
      ? "SAM.gov registration confirmed"
      : "Confirm SAM.gov registration and UEI",
    fixTab: "team",
  });
  rows.push({
    category: "Federal contracts / IDIQ",
    status:
      (org?.naics_codes?.length ?? 0) > 0 && org?.sam_registered
        ? "ready"
        : (org?.naics_codes?.length ?? 0) > 0
          ? "partial"
          : "not_ready",
    detail:
      (org?.naics_codes?.length ?? 0) > 0
        ? "NAICS codes on file"
        : "Upload a capability statement to capture NAICS codes",
    fixTab: "team",
  });
  rows.push({
    category: "SBIR / STTR (federal R&D)",
    status: forProfit ? "partial" : "not_ready",
    detail: forProfit
      ? "Add R&D focus areas and key technical staff"
      : "Requires a for-profit entity with an R&D focus",
    fixTab: "website",
  });
  rows.push({
    category: "State & local government",
    status: (org?.operating_states?.length ?? 0) > 0 ? "ready" : "partial",
    detail:
      (org?.operating_states?.length ?? 0) > 0
        ? "Service area recorded"
        : "Add the states and counties you serve",
    fixTab: "website",
  });
  rows.push({
    category: "Capacity-building & staffing grants",
    status: people.length >= 2 ? "ready" : people.length === 1 ? "partial" : "not_ready",
    detail: people.length >= 2 ? "Team profiles on file" : "Add at least two staff resumes",
    fixTab: "team",
  });
  return rows;
}
