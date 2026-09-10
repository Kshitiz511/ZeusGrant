import type { Tables } from "@/integrations/supabase/types";
import {
  classifyGeography,
  computeUserFundingGeography,
  expansionExplainer,
  type GeoClassification,
  type UserFundingGeography,
} from "@/lib/geography";

export type Opportunity = Tables<"opportunities">;
export type OrgProfile = Tables<"org_profiles">;

export type MatchReason = { label: string; positive: boolean };

export type Match = {
  opportunity: Opportunity;
  score: number;
  reasons: MatchReason[];
  eligible: boolean;
  daysLeft: number | null;
  geo: GeoClassification;
  expansionNote: string | null;
  readiness: number;
};

const norm = (v: string) => v.trim().toLowerCase();

function overlap(a: string[] | null, b: string[] | null) {
  if (!a?.length || !b?.length) return [] as string[];
  const setB = new Set(b.map(norm));
  return a.filter((x) => setB.has(norm(x)));
}

export function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const ms = new Date(`${date}T23:59:59Z`).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

/**
 * Application readiness (separate from match score): how prepared the
 * organization is to actually submit this application.
 */
function readinessScore(org: OrgProfile | null, opp: Opportunity) {
  let pts = 0;
  if (org?.ein) pts += 20;
  if (org?.mission && org.mission.length > 60) pts += 15;
  if (org?.annual_budget) pts += 15;
  if (org?.year_founded) pts += 10;
  if (org?.staff_size) pts += 10;
  if ((org?.focus_areas ?? []).length) pts += 10;
  if (org?.readiness_notes) pts += 5;
  if (org?.website) pts += 5;
  pts += opp.match_required ? 0 : 10;
  return Math.min(100, pts);
}

/**
 * Transparent match score out of 100:
 *  geography 25 · focus areas 25 · applicant type 15 · award fit 15 ·
 *  populations served 10 · deadline runway 10.
 * Mandatory eligibility (applicant type, geography, deadline) is a hard gate.
 */
export function scoreOpportunity(
  org: OrgProfile | null,
  opp: Opportunity,
  geography?: UserFundingGeography,
): Match {
  const geo = geography ?? computeUserFundingGeography(org);
  const reasons: MatchReason[] = [];
  let score = 0;
  let eligible = true;

  // Geography (25)
  const cls = classifyGeography(geo, opp);
  const expansionNote = cls === "TARGET MARKET" ? expansionExplainer(geo, opp) : null;
  if (cls === "LOCAL") {
    score += 25;
    reasons.push({ label: "Local opportunity in your community", positive: true });
  } else if (cls === "HOME STATE") {
    score += 23;
    reasons.push({ label: `Available where you operate`, positive: true });
  } else if (cls === "REGIONAL") {
    score += 21;
    reasons.push({ label: `Covers your region (${opp.region ?? "multi-state"})`, positive: true });
  } else if (cls === "NATIONAL") {
    score += 18;
    reasons.push({ label: "Nationwide eligibility", positive: true });
  } else if (cls === "TARGET MARKET") {
    score += 14;
    reasons.push({ label: "In a target expansion market", positive: true });
  } else {
    eligible = false;
    reasons.push({
      label: `Limited to ${opp.eligible_states.join(", ") || "another geography"}`,
      positive: false,
    });
  }

  if (opp.project_location_required && geo.projectLocationFlexibility === "No") {
    reasons.push({
      label: "Project must be performed in the funder's geography",
      positive: false,
    });
    score -= 4;
  }

  // Focus areas (25)
  const focusHits = overlap(org?.focus_areas ?? [], opp.focus_areas);
  if (focusHits.length) {
    score += Math.min(25, 13 + focusHits.length * 6);
    reasons.push({ label: `Focus match: ${focusHits.slice(0, 3).join(", ")}`, positive: true });
  } else if (org?.focus_areas?.length) {
    reasons.push({ label: "No overlap with your focus areas", positive: false });
  }

  // Applicant type (15) — mandatory gate
  const orgType = org?.org_type ? norm(org.org_type) : null;
  if (orgType && opp.eligible_org_types.length) {
    const ok = opp.eligible_org_types.some(
      (t) => norm(t) === orgType || orgType.includes(norm(t)) || norm(t).includes(orgType),
    );
    if (ok) {
      score += 15;
      reasons.push({ label: `Open to ${org?.org_type} applicants`, positive: true });
    } else {
      eligible = false;
      reasons.push({ label: `Restricted to ${opp.eligible_org_types.join(", ")}`, positive: false });
    }
  } else if (!opp.eligible_org_types.length) {
    score += 9;
  }

  // Award fit (15)
  const wantMin = org?.funding_amount_min ?? null;
  const wantMax = org?.funding_amount_max ?? null;
  if (wantMin !== null || wantMax !== null) {
    const oppMin = opp.award_min ?? 0;
    const oppMax = opp.award_max ?? Number.MAX_SAFE_INTEGER;
    const rangesOverlap = (wantMin ?? 0) <= oppMax && (wantMax ?? Number.MAX_SAFE_INTEGER) >= oppMin;
    if (rangesOverlap) {
      score += 15;
      reasons.push({ label: "Award size fits your funding need", positive: true });
    } else {
      reasons.push({ label: "Award size outside your target range", positive: false });
    }
  } else {
    score += 7;
  }

  // Populations served (10)
  const popHits = overlap(org?.populations_served ?? [], opp.populations_served);
  if (popHits.length) {
    score += 10;
    reasons.push({ label: `Serves ${popHits.slice(0, 2).join(", ")}`, positive: true });
  }

  // Deadline runway (10)
  const daysLeft = daysUntil(opp.deadline);
  if (daysLeft !== null) {
    if (daysLeft < 0 && !opp.is_forecasted) {
      eligible = false;
      reasons.push({ label: "Deadline has passed", positive: false });
    } else if (daysLeft >= 21) {
      score += 10;
      reasons.push({ label: `${daysLeft} days to prepare`, positive: true });
    } else {
      score += 4;
      reasons.push({ label: `Closes in ${daysLeft} days`, positive: false });
    }
  }

  if (opp.is_forecasted) {
    reasons.push({ label: "Forecasted — not yet open, prepare in advance", positive: false });
  }
  if (opp.opportunity_type !== "grant") {
    reasons.push({ label: `Funding type: ${opp.opportunity_type}`, positive: false });
  }
  if (opp.match_required) {
    reasons.push({ label: "Cost share / match required", positive: false });
  }

  return {
    opportunity: opp,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    eligible,
    daysLeft,
    geo: cls,
    expansionNote,
    readiness: readinessScore(org, opp),
  };
}

export function rankOpportunities(org: OrgProfile | null, opps: Opportunity[]): Match[] {
  const geo = computeUserFundingGeography(org);
  return opps
    .map((o) => scoreOpportunity(org, o, geo))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}

export function formatAward(min: number | null, max: number | null) {
  const f = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `$${(n / 1000).toFixed(0)}K`;
  if (min !== null && max !== null) return `${f(min)} – ${f(max)}`;
  if (max !== null) return `Up to ${f(max)}`;
  if (min !== null) return `From ${f(min)}`;
  return "Amount varies";
}

export function sourceTypeLabel(reliability: number) {
  if (reliability >= 100) return "Official API";
  if (reliability >= 98) return "Official government website";
  if (reliability >= 95) return "Official funder website";
  if (reliability >= 90) return "Licensed database";
  if (reliability >= 85) return "Economic development authority";
  if (reliability >= 75) return "Established secondary source";
  return "Search discovery — pending verification";
}
