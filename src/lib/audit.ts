import type { Tables } from "@/integrations/supabase/types";
import { isClosed, riskOf, type ComplianceObligation } from "@/lib/compliance";

export type EvidenceFile = Tables<"evidence_vault_files">;
export type AuditPackage = Tables<"audit_packages">;
export type RegulatoryCitation = Tables<"regulatory_citations">;
export type AgencyAccess = Tables<"agency_portal_access">;

export const EVIDENCE_DOCUMENT_TYPES = [
  "Submitted report",
  "Invoice",
  "Receipt",
  "Signed deliverable",
  "Email confirmation",
  "Portal confirmation",
  "Meeting minutes",
  "Insurance certificate",
  "Other",
] as const;

export type ReadinessBand = "ready" | "mostly" | "partial" | "not_ready";

export const BAND_LABEL: Record<ReadinessBand, string> = {
  ready: "Audit Ready",
  mostly: "Mostly Documented",
  partial: "Partially Documented",
  not_ready: "Not Audit Ready",
};

export const BAND_CLASS: Record<ReadinessBand, string> = {
  ready: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
  mostly: "bg-sky-500/10 text-sky-700 border-sky-500/30",
  partial: "bg-yellow-500/10 text-yellow-700 border-yellow-500/30",
  not_ready: "bg-destructive/10 text-destructive border-destructive/30",
};

export function bandFor(score: number): ReadinessBand {
  if (score >= 90) return "ready";
  if (score >= 70) return "mostly";
  if (score >= 40) return "partial";
  return "not_ready";
}

export type AuditReadiness = {
  score: number;
  band: ReadinessBand;
  /** Obligations that should already have evidence on file. */
  expected: number;
  documented: number;
  missing: ComplianceObligation[];
};

/**
 * Audit readiness measures proof, not progress: every obligation that is
 * complete or already past due should have at least one evidence file.
 */
export function auditReadiness(
  obligations: ComplianceObligation[],
  evidence: EvidenceFile[],
): AuditReadiness {
  const byObligation = new Set(
    evidence.map((e) => e.obligation_id).filter((v): v is string => Boolean(v)),
  );
  const expectedList = obligations.filter(
    (o) => isClosed(o) || riskOf(o) === "overdue",
  );
  const missing = expectedList.filter((o) => !byObligation.has(o.id));
  const documented = expectedList.length - missing.length;
  const score = expectedList.length === 0 ? 100 : Math.round((documented / expectedList.length) * 100);
  return { score, band: bandFor(score), expected: expectedList.length, documented, missing };
}

/** SHA-256 of the file contents, computed before upload for tamper evidence. */
export async function sha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function formatStamp(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
