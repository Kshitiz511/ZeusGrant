import type { Tables } from "@/integrations/supabase/types";

export type ComplianceContract = Tables<"compliance_contracts">;
export type ComplianceObligation = Tables<"compliance_obligations">;
export type BudgetCategory = Tables<"compliance_budget_categories">;
export type RateCard = Tables<"compliance_rate_cards">;
export type ComplianceInvoice = Tables<"compliance_invoices">;
export type ComplianceDocument = Tables<"compliance_documents">;
export type DeliverableProgress = Tables<"compliance_deliverable_progress">;

// --- Vocabularies -----------------------------------------------------------

export const OBLIGATION_CATEGORIES = [
  { id: "reporting", label: "Reporting" },
  { id: "financial", label: "Financial" },
  { id: "deliverable", label: "Deliverable" },
  { id: "administrative", label: "Administrative" },
  { id: "legal", label: "Legal & regulatory" },
  { id: "intellectual_property", label: "IP & data" },
  { id: "communication", label: "Stakeholder & communication" },
] as const;

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  OBLIGATION_CATEGORIES.map((c) => [c.id, c.label]),
);

/** Category colour used on cards, timeline bars and the contract viewer. */
export const CATEGORY_CLASS: Record<string, string> = {
  reporting: "bg-blue-500",
  financial: "bg-emerald-500",
  deliverable: "bg-orange-500",
  administrative: "bg-purple-500",
  legal: "bg-red-500",
  intellectual_property: "bg-cyan-500",
  communication: "bg-pink-500",
};

export const OBLIGATION_STATUSES = [
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "under_review", label: "Under review" },
  { id: "blocked", label: "Blocked" },
  { id: "complete", label: "Completed" },
  { id: "waived", label: "Waived" },
  { id: "not_applicable", label: "N/A" },
] as const;

/** Kanban lanes. "overdue" is derived, not a stored status. */
export const BOARD_LANES = [
  { id: "not_started", label: "Not started" },
  { id: "in_progress", label: "In progress" },
  { id: "under_review", label: "Under review" },
  { id: "complete", label: "Completed" },
  { id: "overdue", label: "Overdue" },
] as const;

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  [...OBLIGATION_STATUSES, { id: "submitted", label: "Submitted" }].map((s) => [s.id, s.label]),
);

export const CLOSED_STATUSES = ["complete", "waived", "not_applicable"];

export const RECURRENCES = [
  "one_time",
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
] as const;

export const PRIORITIES = ["low", "medium", "high"] as const;

export const COMPENSATION_TYPES = [
  { id: "lump_sum", label: "Lump sum" },
  { id: "hourly", label: "Hourly / time and materials" },
  { id: "cost_reimbursement", label: "Cost reimbursement" },
  { id: "mixed", label: "Mixed" },
] as const;

export const CONTRACT_TYPES = [
  { id: "grant_award", label: "Grant award" },
  { id: "government_contract", label: "Government contract" },
  { id: "foundation_grant", label: "Foundation grant" },
  { id: "mou", label: "MOU / MOA" },
  { id: "service_contract", label: "Service contract" },
  { id: "subcontract", label: "Subcontract" },
  { id: "other", label: "Other" },
] as const;

export const CONTRACT_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTRACT_TYPES.map((c) => [c.id, c.label]),
);

export const TEAM_ROLES = [
  { id: "owner", label: "Owner", hint: "Full access, including contract settings and deletion" },
  { id: "manager", label: "Manager", hint: "Assign tasks, update status, upload evidence" },
  { id: "contributor", label: "Contributor", hint: "Update only tasks assigned to them" },
  { id: "viewer", label: "Viewer", hint: "Read-only access" },
] as const;

/** Default reminder ladder (days before due). */
export const REMINDER_DAYS = [60, 30, 14, 7, 3, 1] as const;

export const REMINDER_SCHEDULE: { days: number; alert: string }[] = [
  { days: 60, alert: "In-app notification to the project owner" },
  { days: 30, alert: "In-app notification + email to the assignee" },
  { days: 14, alert: "In-app + email to assignee and project owner" },
  { days: 7, alert: "In-app + email + push (if enabled)" },
  { days: 3, alert: "Urgent in-app banner + email to the whole contract team" },
  { days: 1, alert: "Final warning email to assignee and owner" },
  { days: 0, alert: "Red banner on the dashboard" },
];

export const CONTRACT_UPLOAD_TYPES = ".pdf,.docx,.doc,.txt,.md";

export type ConfidenceLevel = "high" | "medium" | "low";

export function confidenceLevel(value: number | string | null | undefined): ConfidenceLevel {
  const n = Number(value ?? 0);
  if (n >= 0.8) return "high";
  if (n >= 0.5) return "medium";
  return "low";
}


// --- Formatting -------------------------------------------------------------

export function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return "—";
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

// --- Risk / status ----------------------------------------------------------

export type ObligationRisk = "complete" | "overdue" | "due_soon" | "upcoming" | "no_date";

export function isClosed(o: ComplianceObligation): boolean {
  return CLOSED_STATUSES.includes(o.status);
}

export function riskOf(o: ComplianceObligation): ObligationRisk {
  if (isClosed(o)) return "complete";
  const d = daysUntil(o.due_date);
  if (d === null) return "no_date";
  if (d < 0) return "overdue";
  if (d <= 14) return "due_soon";
  return "upcoming";
}

/** Which Kanban lane an obligation belongs in ("overdue" is derived). */
export function laneOf(o: ComplianceObligation): string {
  if (isClosed(o)) return "complete";
  if (riskOf(o) === "overdue") return "overdue";
  if (o.status === "under_review" || o.status === "submitted") return "under_review";
  if (o.status === "in_progress" || o.status === "blocked") return "in_progress";
  return "not_started";
}

/** Next occurrence of a recurring obligation, from a given date. */
export function nextOccurrence(date: string | null, recurrence: string): string | null {
  if (!date || recurrence === "one_time") return null;
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const add: Record<string, () => void> = {
    daily: () => d.setUTCDate(d.getUTCDate() + 1),
    weekly: () => d.setUTCDate(d.getUTCDate() + 7),
    monthly: () => d.setUTCMonth(d.getUTCMonth() + 1),
    quarterly: () => d.setUTCMonth(d.getUTCMonth() + 3),
    semi_annual: () => d.setUTCMonth(d.getUTCMonth() + 6),
    annual: () => d.setUTCFullYear(d.getUTCFullYear() + 1),
  };
  const fn = add[recurrence];
  if (!fn) return null;
  fn();
  return d.toISOString().slice(0, 10);
}

export const RISK_CLASS: Record<ObligationRisk, string> = {
  complete: "bg-emerald-500",
  overdue: "bg-destructive",
  due_soon: "bg-yellow-500",
  upcoming: "bg-primary",
  no_date: "bg-muted-foreground",
};

export const RISK_LABEL: Record<ObligationRisk, string> = {
  complete: "Complete",
  overdue: "Overdue",
  due_soon: "Due within 14 days",
  upcoming: "Upcoming",
  no_date: "No due date",
};

export function isActionable(o: ComplianceObligation): boolean {
  if (isClosed(o)) return false;
  if (o.reminders_silenced) return false;
  if (o.snoozed_until && daysUntil(o.snoozed_until)! > 0) return false;
  const risk = riskOf(o);
  return risk === "overdue" || risk === "due_soon";
}

// --- Analytics --------------------------------------------------------------

export type ComplianceSummary = {
  total: number;
  complete: number;
  overdue: number;
  dueSoon: number;
  upcoming30: number;
  completionRate: number;
  byCategory: {
    category: string;
    label: string;
    total: number;
    complete: number;
    overdue: number;
  }[];
  byStatus: { id: string; label: string; count: number }[];
  healthScore: number;
};

/** Contract health = (completed on time + not yet due) / total. */
export function healthScoreOf(obligations: ComplianceObligation[]): number {
  if (!obligations.length) return 100;
  const good = obligations.filter((o) => {
    if (isClosed(o)) {
      if (!o.due_date || !o.completed_at) return true;
      return o.completed_at.slice(0, 10) <= o.due_date;
    }
    return riskOf(o) !== "overdue";
  }).length;
  return Math.round((good / obligations.length) * 100);
}

export function healthTone(score: number): "good" | "warn" | "bad" {
  if (score >= 80) return "good";
  if (score >= 60) return "warn";
  return "bad";
}

export function summarize(obligations: ComplianceObligation[]): ComplianceSummary {
  const total = obligations.length;
  const complete = obligations.filter(isClosed).length;
  const overdue = obligations.filter((o) => riskOf(o) === "overdue").length;
  const dueSoon = obligations.filter((o) => riskOf(o) === "due_soon").length;
  const upcoming30 = obligations.filter((o) => {
    const d = daysUntil(o.due_date);
    return !isClosed(o) && d !== null && d >= 0 && d <= 30;
  }).length;
  const completionRate = total ? Math.round((complete / total) * 100) : 0;

  const byCategory = OBLIGATION_CATEGORIES.map((c) => {
    const rows = obligations.filter((o) => o.category === c.id);
    return {
      category: c.id,
      label: c.label,
      total: rows.length,
      complete: rows.filter(isClosed).length,
      overdue: rows.filter((o) => riskOf(o) === "overdue").length,
    };
  }).filter((c) => c.total > 0);

  const byStatus = BOARD_LANES.map((l) => ({
    id: l.id,
    label: l.label,
    count: obligations.filter((o) => laneOf(o) === l.id).length,
  }));

  return {
    total,
    complete,
    overdue,
    dueSoon,
    upcoming30,
    completionRate,
    byCategory,
    byStatus,
    healthScore: healthScoreOf(obligations),
  };
}


// --- Financials -------------------------------------------------------------

export type ContractFinancials = {
  contractValue: number;
  budgeted: number;
  spent: number;
  remaining: number;
  utilization: number;
  reimbursableCap: number | null;
  reimbursablesBilled: number;
  reimbursablesRemaining: number | null;
  invoicedFees: number;
  invoicedTotal: number;
  paidTotal: number;
  percentComplete: number;
};

export function financials(
  contract: ComplianceContract,
  categories: BudgetCategory[],
  invoices: ComplianceInvoice[],
): ContractFinancials {
  const contractValue = Number(contract.lump_sum_amount ?? contract.award_amount ?? 0);
  const budgeted = categories.reduce((n, c) => n + Number(c.budgeted_amount ?? 0), 0);
  const spent = categories.reduce((n, c) => n + Number(c.spent_amount ?? 0), 0);
  const base = budgeted || contractValue;

  const invoicedFees = invoices.reduce((n, i) => n + Number(i.fee_amount ?? 0), 0);
  const reimbursablesBilled = invoices.reduce(
    (n, i) => n + Number(i.reimbursables_amount ?? 0),
    0,
  );
  const paidTotal = invoices
    .filter((i) => i.status === "paid")
    .reduce((n, i) => n + Number(i.fee_amount ?? 0) + Number(i.reimbursables_amount ?? 0), 0);

  const cap = contract.reimbursable_cap === null ? null : Number(contract.reimbursable_cap);

  return {
    contractValue,
    budgeted,
    spent,
    remaining: base - spent,
    utilization: base ? Math.round((spent / base) * 100) : 0,
    reimbursableCap: cap,
    reimbursablesBilled,
    reimbursablesRemaining: cap === null ? null : cap - reimbursablesBilled,
    invoicedFees,
    invoicedTotal: invoicedFees + reimbursablesBilled,
    paidTotal,
    percentComplete: contractValue
      ? Math.min(100, Math.round((invoicedFees / contractValue) * 100))
      : 0,
  };
}

/** Amount billable for a percent-complete invoice against a lump sum fee. */
export function percentCompleteFee(
  contract: ComplianceContract,
  percent: number,
  alreadyInvoiced: number,
): number {
  const total = Number(contract.lump_sum_amount ?? contract.award_amount ?? 0);
  if (!total) return 0;
  return Math.max(0, Math.round((total * percent) / 100 - alreadyInvoiced));
}

export function reimbursableTotal(cost: number, multiplier: number | null | undefined): number {
  return Math.round(cost * Number(multiplier ?? 1) * 100) / 100;
}

// --- Plan capabilities ------------------------------------------------------

export type ComplianceCapabilities = {
  contractsMax: number | null;
  timelineView: boolean;
  budgetTracking: boolean;
  teamAssignment: boolean;
  csvExport: boolean;
  pdfReport: boolean;
  healthScore: boolean;
  whiteLabelReport: boolean;
};

const CAPS: Record<string, ComplianceCapabilities> = {
  starter: {
    contractsMax: 2,
    timelineView: false,
    budgetTracking: false,
    teamAssignment: false,
    csvExport: false,
    pdfReport: false,
    healthScore: false,
    whiteLabelReport: false,
  },
  growth: {
    contractsMax: 10,
    timelineView: true,
    budgetTracking: true,
    teamAssignment: true,
    csvExport: true,
    pdfReport: true,
    healthScore: false,
    whiteLabelReport: false,
  },
  professional: {
    contractsMax: null,
    timelineView: true,
    budgetTracking: true,
    teamAssignment: true,
    csvExport: true,
    pdfReport: true,
    healthScore: true,
    whiteLabelReport: false,
  },
  agency: {
    contractsMax: null,
    timelineView: true,
    budgetTracking: true,
    teamAssignment: true,
    csvExport: true,
    pdfReport: true,
    healthScore: true,
    whiteLabelReport: true,
  },
};

const TRIAL_CAPS: ComplianceCapabilities = {
  contractsMax: 1,
  timelineView: false,
  budgetTracking: false,
  teamAssignment: false,
  csvExport: false,
  pdfReport: false,
  healthScore: false,
  whiteLabelReport: false,
};

export function complianceCapabilities(
  planId: string | undefined,
  isTrialing: boolean,
): ComplianceCapabilities {
  if (isTrialing) return TRIAL_CAPS;
  return CAPS[planId ?? ""] ?? TRIAL_CAPS;
}

// --- Extraction payload -----------------------------------------------------

export type ExtractedObligation = {
  category: string;
  title: string;
  description: string;
  due_date: string | null;
  recurrence: string;
  priority: string;
  prior_approval_required: boolean;
  amount: number | null;
  source_quote: string;
  source_page: number | null;
  confidence: number;
};

export type ExtractedContract = {
  name: string;
  funder: string;
  contract_number: string | null;
  award_amount: number | null;
  period_start: string | null;
  period_end: string | null;
  compensation_type: string;
  lump_sum_amount: number | null;
  reimbursable_cap: number | null;
  reimbursable_multiplier: number | null;
  invoicing_basis: string | null;
  summary: string;
  obligations: ExtractedObligation[];
  budget_categories: { name: string; category_type: string; budgeted_amount: number }[];
  rate_cards: { labor_category: string; level: string | null; hourly_rate: number }[];
};

// --- Client-side text extraction -------------------------------------------

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".txt") || name.endsWith(".md")) return file.text();

  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth/mammoth.browser");
    const buffer = await file.arrayBuffer();
    const result = await (
      mammoth as unknown as {
        extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
      }
    ).extractRawText({ arrayBuffer: buffer });
    return result.value;
  }

  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, 50); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pages.push(`[page ${i}]\n${text}`);
    }
    return pages.join("\n\n");
  }

  throw new Error("Upload a PDF, DOCX, TXT or MD file.");
}

// --- Persisted extraction record --------------------------------------------

export const EXTRACTION_MODEL = "google/gemini-2.5-flash";

export type ReviewAction = "accepted" | "edited" | "removed_by_user" | "manually_added";

export const REVIEW_ACTION_LABEL: Record<string, string> = {
  accepted: "Accepted",
  edited: "Edited",
  removed_by_user: "Removed",
  manually_added: "Manually added",
};

export const REVIEW_ACTION_CLASS: Record<string, string> = {
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  edited: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  removed_by_user: "bg-muted text-muted-foreground line-through",
  manually_added: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
};

export const CONFIDENCE_CLASS: Record<ConfidenceLevel, string> = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  low: "bg-red-500/15 text-red-700 dark:text-red-400",
};

/** One obligation as it lives on the review screen (working copy of the AI output). */
export type ReviewObligation = ExtractedObligation & {
  /** Index in the original AI extraction, or null for user-added rows. */
  ai_index: number | null;
  removed?: boolean;
  manual?: boolean;
};

export type ReviewDraft = Omit<ExtractedContract, "obligations"> & {
  obligations: ReviewObligation[];
};

/** Everything persisted to compliance_contracts.raw_extraction. */
export type RawExtraction = {
  model: string;
  extracted_at: string;
  source_label: string;
  /** Untouched AI output. Never modified by user edits. */
  extraction: ExtractedContract;
  /** Live review-screen progress so a mid-review exit loses nothing. */
  review_draft?: ReviewDraft;
  review_completed_at?: string | null;
};

export function toReviewDraft(extraction: ExtractedContract): ReviewDraft {
  return {
    ...extraction,
    obligations: extraction.obligations.map((o, i) => ({ ...o, ai_index: i })),
  };
}

export function reviewActionFor(
  o: ReviewObligation,
  original: ExtractedObligation | undefined,
): ReviewAction {
  if (o.manual || o.ai_index === null || !original) return "manually_added";
  if (o.removed) return "removed_by_user";
  const changed =
    o.title !== original.title ||
    o.description !== original.description ||
    o.due_date !== original.due_date ||
    o.category !== original.category ||
    o.amount !== original.amount;
  return changed ? "edited" : "accepted";
}

export function parseRawExtraction(value: unknown): RawExtraction | null {
  if (!value || typeof value !== "object") return null;
  const r = value as RawExtraction;
  return r.extraction && Array.isArray(r.extraction.obligations) ? r : null;
}
