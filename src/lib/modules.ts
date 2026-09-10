export type ModuleId = "grant_intelligence" | "contract_compliance" | "audit_compliance";

export type ModulePlan = {
  id: string;
  name: string;
  monthly: number | null;
  annual: number | null;
  monthlyPriceId?: string;
  annualPriceId?: string;
  highlights: string[];
};

export type PlatformModule = {
  id: ModuleId;
  slug: string;
  name: string;
  tagline: string;
  /** Sidebar route prefixes that belong to this module. */
  routes: string[];
  features: string[];
  plans: ModulePlan[];
};

export const TRIAL_DAYS = 3;

/** Annual billing is 17% cheaper than paying monthly. */
export const ANNUAL_DISCOUNT = 0.17;
/** Bundle discounts by number of active modules. */
export const BUNDLE_DISCOUNT: Record<number, number> = { 1: 0, 2: 0.1, 3: 0.15 };

function annualPrice(monthly: number): number {
  return Math.round(monthly * 12 * (1 - ANNUAL_DISCOUNT));
}

function plan(
  module: string,
  id: string,
  name: string,
  monthly: number | null,
  highlights: string[],
): ModulePlan {
  if (monthly === null) {
    return { id, name, monthly: null, annual: null, highlights };
  }
  return {
    id,
    name,
    monthly,
    annual: annualPrice(monthly),
    monthlyPriceId: `${module}_${id}_monthly`,
    annualPriceId: `${module}_${id}_annual`,
    highlights,
  };
}

export const MODULES: PlatformModule[] = [
  {
    id: "grant_intelligence",
    slug: "grant-intelligence",
    name: "Grant Intelligence Suite",
    tagline: "Find, qualify and win funding.",
    routes: [
      "/profile",
      "/dashboard",
      "/opportunities",
      "/tracker",
      "/proposals",
      "/reports",
      "/team",
      "/onboarding",
      "/documents",
    ],
    features: [
      "Profile Intelligence with strength scoring",
      "Opportunity matching and fit scores",
      "Resume Bank and Team Recommender",
      "Proposal Writing Engine with exports",
      "Grant Tracker pipeline and calendar",
      "Scans, email reports and analytics",
    ],
    plans: [
      plan("gi", "starter", "Starter", 49, ["1 profile", "25 matches/month", "1 proposal draft"]),
      plan("gi", "growth", "Growth", 99, ["3 team members", "100 matches/month", "5 drafts"]),
      plan("gi", "professional", "Professional", 199, ["10 team members", "Unlimited matches", "15 drafts"]),
      plan("gi", "agency", "Agency", 399, ["10 client workspaces", "25 users", "40 drafts"]),
      plan("gi", "enterprise", "Enterprise", null, ["Custom users, SSO and integrations"]),
    ],
  },
  {
    id: "contract_compliance",
    slug: "contract-compliance",
    name: "Contract Compliance Manager",
    tagline: "Never miss a contract obligation.",
    routes: ["/compliance", "/my-tasks"],
    features: [
      "Contract upload with AI obligation extraction",
      "Task board, task list and Gantt timeline",
      "Compliance dashboard and health score",
      "Team assignment and recurring tasks",
      "Smart deadline alerts",
      "Compliance Status Report PDF",
    ],
    plans: [
      plan("cc", "starter", "Starter", 39, ["1 contract", "Board and list views"]),
      plan("cc", "growth", "Growth", 79, ["5 contracts", "Timeline, budget, CSV export"]),
      plan("cc", "professional", "Professional", 149, ["15 contracts", "Health score, assignments"]),
      plan("cc", "agency", "Agency", 299, ["Unlimited contracts", "White-label reports"]),
      plan("cc", "enterprise", "Enterprise", null, ["Custom volume and controls"]),
    ],
  },
  {
    id: "audit_compliance",
    slug: "audit-compliance",
    name: "Audit Compliance & Documentation Vault",
    tagline: "Prove it, with timestamped evidence.",
    routes: ["/audit"],
    features: [
      "Evidence Vault organised the way auditors expect",
      "Server-stamped, hashed, tamper-evident uploads",
      "Audit Readiness Score",
      "Compliance Documentation Package (PDF / ZIP)",
      "Time-limited read-only share links",
      "Regulatory citations with plain-language summaries",
      "Agency Portal for contracting officers (Enterprise)",
    ],
    plans: [
      plan("ac", "starter", "Starter", 59, ["1 contract vault", "PDF packages"]),
      plan("ac", "growth", "Growth", 129, ["5 contract vaults", "ZIP packages", "Share links"]),
      plan("ac", "professional", "Professional", 249, ["15 vaults", "Regulatory citations"]),
      plan("ac", "agency", "Agency", 449, ["Unlimited vaults", "White-label packages"]),
      plan("ac", "enterprise", "Enterprise", null, ["Agency Portal external access"]),
    ],
  },
];

export function moduleById(id: ModuleId): PlatformModule {
  return MODULES.find((m) => m.id === id)!;
}

export function moduleBySlug(slug: string): PlatformModule | undefined {
  return MODULES.find((m) => m.slug === slug);
}

export function moduleForRoute(path: string): PlatformModule | undefined {
  return MODULES.find((m) => m.routes.some((r) => path === r || path.startsWith(`${r}/`)));
}

export function startingPrice(m: PlatformModule): number {
  return Math.min(...m.plans.filter((p) => p.monthly !== null).map((p) => p.monthly as number));
}

export function planFor(moduleId: ModuleId, planId: string | null | undefined): ModulePlan | undefined {
  if (!planId) return undefined;
  return moduleById(moduleId).plans.find((p) => p.id === planId);
}

export type Selection = { module: ModuleId; planId: string };

export type PriceSummary = {
  lines: { module: PlatformModule; plan: ModulePlan; amount: number }[];
  subtotal: number;
  bundleDiscount: number;
  bundleRate: number;
  total: number;
  hasCustom: boolean;
  interval: "month" | "year";
};

/** Dynamic price summary with bundle discount applied automatically. */
export function priceSummary(selections: Selection[], annual: boolean): PriceSummary {
  const lines = selections
    .map((s) => {
      const module = moduleById(s.module);
      const plan = module.plans.find((p) => p.id === s.planId);
      if (!plan) return null;
      const amount = (annual ? plan.annual : plan.monthly) ?? 0;
      return { module, plan, amount };
    })
    .filter((l): l is PriceSummary["lines"][number] => l !== null);

  const hasCustom = lines.some((l) => l.plan.monthly === null);
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const bundleRate = BUNDLE_DISCOUNT[lines.length] ?? 0;
  const bundleDiscount = Math.round(subtotal * bundleRate);
  return {
    lines,
    subtotal,
    bundleDiscount,
    bundleRate,
    total: subtotal - bundleDiscount,
    hasCustom,
    interval: annual ? "year" : "month",
  };
}

export function money(value: number): string {
  return `$${value.toLocaleString()}`;
}
