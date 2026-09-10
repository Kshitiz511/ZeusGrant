import type { Tables } from "@/integrations/supabase/types";

export type ProposalRow = Tables<"proposals">;

export type EligibilityItem = {
  label: string;
  state: "confirmed" | "verify" | "issue";
  detail: string;
};

export type InterviewQuestion = {
  id: string;
  prompt: string;
  why: string;
  required: boolean;
  prefill?: string;
};

export type InterviewSection = {
  id: string;
  title: string;
  purpose: string;
  questions: InterviewQuestion[];
};

export type DraftSection = {
  id: string;
  title: string;
  requirement: string;
  content: string;
  source: "ai" | "profile" | "placeholder";
};

export type ComplianceItem = {
  label: string;
  state: "pass" | "warn" | "fail";
  detail: string;
};

export type ComplianceResults = {
  items: ComplianceItem[];
  attachments: string[];
  submission_summary: string;
  budget_narrative?: string;
  reviewed_at: string;
};

export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  in_progress: "In Progress",
  interview_complete: "Interview Complete",
  draft_generated: "Draft Generated",
  compliance_reviewed: "Compliance Reviewed",
  downloaded: "Downloaded",
  submitted: "Submitted",
  awarded: "Awarded",
  declined: "Declined",
};

export type ProposalCapabilities = {
  draftsPerMonth: number | null;
  canExport: boolean;
  canUseTemplates: boolean;
  canDuplicate: boolean;
  canWhiteLabel: boolean;
  /** AI "rewrite / expand / shorten" section tools. */
  canReviseSections: boolean;
  complianceLevel: "basic" | "full" | "full_ai";
};

type BaseCaps = Omit<ProposalCapabilities, "draftsPerMonth">;

const PLAN_CAPS: Record<string, BaseCaps> = {
  starter: {
    canExport: false,
    canUseTemplates: false,
    canDuplicate: false,
    canWhiteLabel: false,
    canReviseSections: false,
    complianceLevel: "basic",
  },
  growth: {
    canExport: true,
    canUseTemplates: false,
    canDuplicate: true,
    canWhiteLabel: false,
    canReviseSections: true,
    complianceLevel: "full",
  },
  professional: {
    canExport: true,
    canUseTemplates: true,
    canDuplicate: true,
    canWhiteLabel: false,
    canReviseSections: true,
    complianceLevel: "full_ai",
  },
  agency: {
    canExport: true,
    canUseTemplates: true,
    canDuplicate: true,
    canWhiteLabel: true,
    canReviseSections: true,
    complianceLevel: "full_ai",
  },
};

const TRIAL_CAPS: BaseCaps = {
  canExport: false,
  canUseTemplates: false,
  canDuplicate: false,
  canWhiteLabel: false,
  canReviseSections: false,
  complianceLevel: "basic",
};

export function proposalCapabilities(
  planId: string | undefined,
  draftsPerMonth: number | null,
  isTrialing: boolean,
): ProposalCapabilities {
  const base = PLAN_CAPS[planId ?? ""] ?? TRIAL_CAPS;
  // Trial: in-app preview only — 1 draft, no export, no AI revision, no templates.
  return {
    draftsPerMonth: isTrialing ? 1 : draftsPerMonth,
    ...(isTrialing ? TRIAL_CAPS : base),
  };
}


export function completenessScore(sections: DraftSection[]): number {
  if (!sections.length) return 0;
  let earned = 0;
  for (const s of sections) {
    const text = s.content ?? "";
    const hasPlaceholder = /\[INFORMATION NEEDED/i.test(text);
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    if (!hasPlaceholder && wordCount >= 60) earned += 1;
    else if (!hasPlaceholder && wordCount > 0) earned += 0.6;
    else if (wordCount > 0) earned += 0.3;
  }
  return Math.round((earned / sections.length) * 100);
}

export function wordCount(sections: DraftSection[]): number {
  return sections.reduce(
    (n, s) => n + (s.content ?? "").trim().split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** ~500 words per formatted page. */
export function pageCount(sections: DraftSection[]): number {
  return Math.max(1, Math.ceil(wordCount(sections) / 500));
}

export function proposalFileName(orgName: string, grantName: string, ext: string) {
  const clean = (s: string) => s.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, " ");
  const date = new Date().toISOString().slice(0, 10);
  return `${clean(orgName || "Organization")} — ${clean(grantName)} — Proposal Draft — ${date}.${ext}`;
}

function escapeHtml(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function proposalHtml(opts: {
  title: string;
  funder: string;
  orgName: string;
  sections: { title: string; content: string }[];
}) {
  const body = opts.sections
    .map(
      (s) =>
        `<h2>${escapeHtml(s.title)}</h2>` +
        (s.content || "")
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`)
          .join(""),
    )
    .join('<div style="page-break-after:always"></div>');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
    opts.title,
  )}</title><style>
    @page { size: Letter; margin: 1in; }
    body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.5; color: #000; }
    h1 { font-size: 16pt; margin-bottom: 4pt; }
    h2 { font-size: 13pt; margin-top: 18pt; }
    .meta { font-size: 11pt; color: #333; margin-bottom: 18pt; }
  </style></head><body>
  <h1>${escapeHtml(opts.title)}</h1>
  <div class="meta">${escapeHtml(opts.orgName)} &middot; Submitted to ${escapeHtml(
    opts.funder,
  )}<br/>Prepared ${new Date().toLocaleDateString()}</div>
  ${body}
  </body></html>`;
}

export function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  const doc = frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow?.focus();
  setTimeout(() => {
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 300);
}

export const AI_DISCLAIMER =
  "This proposal was generated with AI assistance based on your answers. You are responsible for reviewing all content for accuracy before submission. GrantMatch AI does not guarantee award outcomes.";
