import type { Tables } from "@/integrations/supabase/types";

export type GrantRecord = Tables<"grant_records">;
export type GrantStageHistory = Tables<"grant_stage_history">;
export type GrantActivity = Tables<"grant_activity_log">;
export type GrantDocument = Tables<"grant_documents">;
export type GrantReportingItem = Tables<"grant_reporting_items">;
export type GrantTeamMember = Tables<"grant_team_members">;

export const STAGES = [
  { id: "identified", label: "Identified", hint: "Found it; not decided yet" },
  { id: "researching", label: "Researching", hint: "Evaluating eligibility and fit" },
  { id: "drafting", label: "Drafting", hint: "Interview or draft in progress" },
  { id: "ready_to_submit", label: "Ready to Submit", hint: "Draft complete, compliance passed" },
  { id: "submitted", label: "Submitted", hint: "Application officially submitted" },
  { id: "under_review", label: "Under Review", hint: "Awaiting funder decision" },
  { id: "info_requested", label: "Additional Info Requested", hint: "Funder asked for more" },
  { id: "awarded", label: "Awarded", hint: "Funding confirmed" },
  { id: "declined", label: "Declined", hint: "Not selected" },
  { id: "withdrawn", label: "Withdrawn", hint: "You withdrew the application" },
  { id: "archived", label: "Archived", hint: "Closed out" },
] as const;

export type StageId = (typeof STAGES)[number]["id"];

export const STAGE_LABEL: Record<string, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.label]),
);

export const PRE_DECISION_STAGES: string[] = [
  "submitted",
  "under_review",
  "info_requested",
];

export const OUTCOMES = ["pending", "awarded", "declined", "withdrawn", "missed"] as const;

export const FUNDER_TYPES = [
  "federal",
  "state",
  "local",
  "foundation",
  "corporate",
  "other",
] as const;

export const DOCUMENT_TYPES = [
  "proposal_draft",
  "submitted_application",
  "budget",
  "award_letter",
  "report",
  "correspondence",
  "other",
] as const;

export const TEAM_ROLES = [
  "Lead Writer",
  "Reviewer",
  "Budget Manager",
  "Submitter",
  "Reporting Lead",
] as const;

export type Urgency = "on_track" | "attention" | "at_risk";

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  return Math.round((target - Date.now()) / 86_400_000);
}

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/** Color-coded urgency for a tracker card. */
export function urgencyOf(record: GrantRecord): Urgency {
  const closed = ["awarded", "declined", "withdrawn", "archived"].includes(record.stage);
  if (closed) return "on_track";

  const dueIn = daysUntil(
    PRE_DECISION_STAGES.includes(record.stage) ? record.decision_date_expected : record.deadline,
  );
  if (dueIn !== null && dueIn < 0) return "at_risk";
  if (dueIn !== null && dueIn <= 14) return "attention";
  if (daysSince(record.last_activity_at) >= 30) return "attention";
  return "on_track";
}

export const URGENCY_CLASS: Record<Urgency, string> = {
  on_track: "bg-accent",
  attention: "bg-yellow-500",
  at_risk: "bg-destructive",
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  on_track: "On track",
  attention: "Attention needed",
  at_risk: "Overdue or at risk",
};

/** A card needs a nudge when a date has passed without a stage update. */
export function pendingPrompt(record: GrantRecord): string | null {
  const deadlinePassed = (daysUntil(record.deadline) ?? 1) < 0;
  if (
    deadlinePassed &&
    ["identified", "researching", "drafting", "ready_to_submit"].includes(record.stage)
  ) {
    return `The deadline for ${record.grant_name} was ${formatDate(record.deadline)}. Did you submit?`;
  }
  const decisionPassed = (daysUntil(record.decision_date_expected) ?? 1) < 0;
  if (decisionPassed && PRE_DECISION_STAGES.includes(record.stage)) {
    return `Have you heard back from ${record.funder} about ${record.grant_name}? Update the status.`;
  }
  return null;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(date.length <= 10 ? `${date}T00:00:00Z` : date);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function compactMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/** Amount that best represents a record's dollar value at its current stage. */
export function recordValue(r: GrantRecord): number {
  return Number(r.awarded_amount ?? r.submitted_amount ?? r.requested_amount ?? 0);
}

// --- Plan capabilities ------------------------------------------------------

export type TrackerCapabilities = {
  csvExport: boolean;
  pdfReport: boolean;
  teamAssignment: boolean;
  whiteLabelReport: boolean;
  calendarView: boolean;
};

const TRACKER_CAPS: Record<string, TrackerCapabilities> = {
  starter: {
    csvExport: false,
    pdfReport: false,
    teamAssignment: false,
    whiteLabelReport: false,
    calendarView: true,
  },
  growth: {
    csvExport: true,
    pdfReport: false,
    teamAssignment: true,
    whiteLabelReport: false,
    calendarView: true,
  },
  professional: {
    csvExport: true,
    pdfReport: true,
    teamAssignment: true,
    whiteLabelReport: false,
    calendarView: true,
  },
  agency: {
    csvExport: true,
    pdfReport: true,
    teamAssignment: true,
    whiteLabelReport: true,
    calendarView: true,
  },
};

const TRIAL_TRACKER_CAPS: TrackerCapabilities = {
  csvExport: false,
  pdfReport: false,
  teamAssignment: false,
  whiteLabelReport: false,
  calendarView: true,
};

export function trackerCapabilities(
  planId: string | undefined,
  isTrialing: boolean,
): TrackerCapabilities {
  if (isTrialing) return TRIAL_TRACKER_CAPS;
  return TRACKER_CAPS[planId ?? ""] ?? TRIAL_TRACKER_CAPS;
}

// --- Exports ----------------------------------------------------------------

export function toCsv(rows: Record<string, string | number | null>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => escape(r[h] ?? "")).join(",")),
  ].join("\n");
}

export function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow?.focus();
  setTimeout(() => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 250);
}

// --- Awards analytics -------------------------------------------------------

export type AwardsSummary = {
  submittedCount: number;
  submittedValue: number;
  awardedCount: number;
  awardedValue: number;
  winRate: number | null;
  pipelineValue: number;
};

const SUBMITTED_STAGES = [
  "submitted",
  "under_review",
  "info_requested",
  "awarded",
  "declined",
];

export function awardsSummary(records: GrantRecord[]): AwardsSummary {
  const submitted = records.filter((r) => SUBMITTED_STAGES.includes(r.stage));
  const awarded = records.filter((r) => r.stage === "awarded");
  const decided = records.filter((r) => r.stage === "awarded" || r.stage === "declined");
  const pipeline = records.filter((r) => PRE_DECISION_STAGES.includes(r.stage));

  return {
    submittedCount: submitted.length,
    submittedValue: submitted.reduce(
      (n, r) => n + Number(r.submitted_amount ?? r.requested_amount ?? 0),
      0,
    ),
    awardedCount: awarded.length,
    awardedValue: awarded.reduce((n, r) => n + Number(r.awarded_amount ?? 0), 0),
    winRate: decided.length ? Math.round((awarded.length / decided.length) * 100) : null,
    pipelineValue: pipeline.reduce(
      (n, r) => n + Number(r.submitted_amount ?? r.requested_amount ?? 0),
      0,
    ),
  };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function lastTwelveMonths(): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(1);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d);
    m.setUTCMonth(d.getUTCMonth() - i);
    out.push(m.toISOString().slice(0, 7));
  }
  return out;
}
