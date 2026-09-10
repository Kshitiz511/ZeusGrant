export type ScanFrequency = "monthly" | "weekly" | "daily";

export type PlanLimits = {
  price_id: string;
  plan_id: string;
  saved_opportunities_max: number | null;
  matches_per_month: number | null;
  proposal_drafts_per_month: number | null;
  team_seats: number | null;
  client_workspaces: number | null;
  scan_frequency: ScanFrequency;
  email_reports: boolean;
  calendar_export: boolean;
  usage_analytics: boolean;
  priority_support: boolean;
};

type PlanFeatures = {
  scan_frequency: ScanFrequency;
  email_reports: boolean;
  calendar_export: boolean;
  usage_analytics: boolean;
  priority_support: boolean;
};

const FEATURES: Record<string, PlanFeatures> = {
  starter: {
    scan_frequency: "monthly",
    email_reports: false,
    calendar_export: false,
    usage_analytics: false,
    priority_support: false,
  },
  growth: {
    scan_frequency: "weekly",
    email_reports: true,
    calendar_export: false,
    usage_analytics: false,
    priority_support: false,
  },
  professional: {
    scan_frequency: "daily",
    email_reports: true,
    calendar_export: true,
    usage_analytics: false,
    priority_support: true,
  },
  agency: {
    scan_frequency: "daily",
    email_reports: true,
    calendar_export: true,
    usage_analytics: true,
    priority_support: true,
  },
  none: {
    scan_frequency: "monthly",
    email_reports: false,
    calendar_export: false,
    usage_analytics: false,
    priority_support: false,
  },
};

/**
 * Client-side mirror of public.plan_limits. The database is the source of
 * truth and enforces the caps; this map is used for instant UI feedback and
 * as a fallback when the plan_limits table has not loaded yet.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  starter_monthly: limits("starter_monthly", "starter", 5, 25, 1, 1, 1),
  starter_annual: limits("starter_annual", "starter", 5, 25, 1, 1, 1),
  growth_monthly: limits("growth_monthly", "growth", null, 100, 5, 4, 1),
  growth_annual: limits("growth_annual", "growth", null, 100, 5, 4, 1),
  professional_monthly: limits("professional_monthly", "professional", null, null, 15, 11, 1),
  professional_annual: limits("professional_annual", "professional", null, null, 15, 11, 1),
  agency_monthly: limits("agency_monthly", "agency", null, null, 40, 25, 10),
  agency_annual: limits("agency_annual", "agency", null, null, 40, 25, 10),
};

function limits(
  price_id: string,
  plan_id: string,
  saved: number | null,
  matches: number | null,
  drafts: number | null,
  seats: number | null,
  workspaces: number | null,
): PlanLimits {
  return {
    price_id,
    plan_id,
    saved_opportunities_max: saved,
    matches_per_month: matches,
    proposal_drafts_per_month: drafts,
    team_seats: seats,
    client_workspaces: workspaces,
    ...(FEATURES[plan_id] ?? FEATURES["none"]!),
  };
}

export const NO_PLAN_LIMITS: PlanLimits = limits("", "none", 0, 0, 0, 0, 0);

export function limitsForPrice(priceId: string | null | undefined): PlanLimits {
  if (!priceId) return NO_PLAN_LIMITS;
  // Module price ids (gi_/cc_/ac_) share the tier allowances of the base plan.
  const base = priceId.replace(/^(gi|cc|ac)_/, "");
  return PLAN_LIMITS[priceId] ?? PLAN_LIMITS[base] ?? NO_PLAN_LIMITS;
}

export function formatLimit(value: number | null): string {
  return value === null ? "Unlimited" : value.toLocaleString();
}

/** First day of the current usage period (calendar month), as YYYY-MM-DD. */
export function currentPeriodStart(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Start of the current billing cycle: the monthly anniversary of the
 * subscription start date. Annual plans still reset drafts monthly.
 * Falls back to the calendar month when there is no subscription.
 * Mirrors public.billing_cycle_start().
 */
export function billingCycleStart(
  subscriptionStart: string | null | undefined,
  now = new Date(),
): string {
  if (!subscriptionStart) return currentPeriodStart(now);
  const start = new Date(subscriptionStart);
  if (Number.isNaN(start.getTime())) return currentPeriodStart(now);

  let months =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  if (months < 0) months = 0;

  const cycle = new Date(start);
  cycle.setUTCMonth(start.getUTCMonth() + months);
  return ymd(cycle);
}

/** End of the current billing cycle (next monthly anniversary). */
export function billingCycleEnd(cycleStart: string): string {
  const d = new Date(`${cycleStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return ymd(d);
}
