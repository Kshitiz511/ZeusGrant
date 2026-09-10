/**
 * Shared security primitives: upload validation, external-URL (SSRF) guards and
 * the vocabulary used by the append-only security activity trail.
 * Browser-safe: no server-only imports here, so server functions can reuse it.
 */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "xls", "xlsx", "txt", "md", "csv", "png", "jpg", "jpeg", "webp",
];

/** Returns an error message when the file must be rejected, otherwise null. */
export function validateFileUpload(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is larger than the 50MB limit.`;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typeOk = file.type ? (ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type) : true;
  const extOk = ALLOWED_EXTENSIONS.includes(ext);

  if (!typeOk || !extOk) {
    return `${file.name} is not an accepted file type (PDF, Word, Excel, text, CSV or image).`;
  }
  if (/[\\/]|\.\./.test(file.name)) return "That file name is not allowed.";
  return null;
}

/** Strips path separators so a file name can never escape its storage folder. */
export function safeStorageName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(-120);
}

const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^0\.0\.0\.0$/,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\./i,
];

/**
 * Validates a user-supplied URL before the server fetches it, blocking
 * loopback, link-local and private-network destinations (SSRF protection).
 */
export function assertSafeExternalUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.startsWith("http") ? input : `https://${input}`);
  } catch {
    throw new Error("Enter a valid web address.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Only http and https addresses are supported.");
  }
  const host = parsed.hostname;
  if (!host || BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("Internal or private addresses are not allowed.");
  }
  if (parsed.port && !["", "80", "443", "8080"].includes(parsed.port)) {
    throw new Error("That port is not allowed.");
  }
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Security activity trail                                             */
/* ------------------------------------------------------------------ */

export type AuditAction =
  | "auth.signed_in"
  | "auth.signed_out"
  | "auth.password_changed"
  | "auth.signed_out_all_devices"
  | "file.uploaded"
  | "file.downloaded"
  | "file.deleted"
  | "data.exported"
  | "contract.created"
  | "contract.deleted"
  | "evidence.uploaded"
  | "audit_package.created"
  | "share_link.created"
  | "share_link.revoked"
  | "agency_access.granted"
  | "agency_access.revoked"
  | "team.member_invited"
  | "team.member_removed"
  | "billing.subscription_changed"
  | "ai.extraction_run"
  | "ai.proposal_generated"
  | "security.rate_limited"
  | "account.deletion_requested";

export const AUDIT_LABEL: Record<string, string> = {
  "auth.signed_in": "Signed in",
  "auth.signed_out": "Signed out",
  "auth.password_changed": "Password changed",
  "auth.signed_out_all_devices": "Signed out of all devices",
  "file.uploaded": "File uploaded",
  "file.downloaded": "File downloaded",
  "file.deleted": "File deleted",
  "data.exported": "Data exported",
  "contract.created": "Contract created",
  "contract.deleted": "Contract deleted",
  "evidence.uploaded": "Evidence uploaded",
  "audit_package.created": "Audit package created",
  "share_link.created": "Share link created",
  "share_link.revoked": "Share link revoked",
  "agency_access.granted": "Agency access granted",
  "agency_access.revoked": "Agency access revoked",
  "team.member_invited": "Team member invited",
  "team.member_removed": "Team member removed",
  "billing.subscription_changed": "Subscription changed",
  "ai.extraction_run": "AI extraction run",
  "ai.proposal_generated": "AI proposal generated",
  "security.rate_limited": "Usage limit reached",
  "account.deletion_requested": "Account deletion requested",
};

export type AuditCategory = "Authentication" | "Files" | "Data" | "Billing" | "AI" | "Sharing" | "Other";

export function auditCategory(action: string): AuditCategory {
  if (action.startsWith("auth.")) return "Authentication";
  if (action.startsWith("file.") || action.startsWith("evidence.")) return "Files";
  if (action.startsWith("share_link.") || action.startsWith("agency_access.")) return "Sharing";
  if (action.startsWith("billing.")) return "Billing";
  if (action.startsWith("ai.")) return "AI";
  if (action.startsWith("data.") || action.startsWith("contract.") || action.startsWith("account."))
    return "Data";
  return "Other";
}

/** Hourly caps for expensive actions, enforced by the database. */
export const RATE_LIMITS: Record<string, number> = {
  "ai.extraction": 20,
  "ai.proposal": 40,
  "website.scan": 15,
  "file.upload": 200,
  "data.export": 5,
};
