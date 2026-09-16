// HTTP client for the Zeus platform.
//
// Same-origin only: every call goes through the Vite/reverse-proxy prefixes
// (/api/core, /api/cc). The bearer token is injected per-request from an
// in-memory getter (never read from storage here) so token handling stays in
// one place (auth.ts) and this module has no ambient security state.
//
// The refresh token is the one exception, and it is not handled here at all:
// it lives in an httpOnly cookie the browser attaches automatically and JS
// cannot read. Only its CSRF companion is readable, and only so we can echo it
// back in a header.

import type {
  ActorUsage,
  AuditEntry,
  CheckoutSession,
  Contract,
  ContractDocument,
  CreateContractInput,
  CreateObligationInput,
  EligibilityCode,
  Entitlements,
  Invite,
  JobStatus,
  MatchPage,
  MatchSummary,
  Member,
  MemberRole,
  Obligation,
  ObligationStatus,
  ObligationWithContract,
  OrgProfile,
  OrgProfileInput,
  PlanOption,
  ScanRequest,
  ScanUsage,
  Seats,
  SessionResponse,
  TokenResponse,
  UpdateContractInput,
  UpdateObligationInput,
  UsageResponse,
} from "./types";

const CORE = "/api/core";
const CC = "/api/cc";

/** Name must match ZEUS_SESSION_CSRF_COOKIE_NAME on the server. */
const CSRF_COOKIE = "zeus_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Shared across every caller in this tab so a refresh cannot race itself.
let inFlightRefresh: Promise<SessionResponse> | null = null;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /**
     * The parsed `detail` field, when the server sent an object rather than a
     * string. Some failures are not dead ends -- "verify your email" carries
     * the user id the next screen needs -- so the caller gets the structure
     * back instead of only a sentence to print.
     */
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type TokenGetter = () => string | null;

async function request<T>(
  url: string,
  opts: RequestInit,
  getToken?: TokenGetter,
): Promise<T> {
  const headers = new Headers(opts.headers);
  // FormData must keep the browser-generated multipart boundary, so only
  // declare JSON when we are actually sending JSON.
  if (!(opts.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }
  const token = getToken?.();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let message = res.statusText;
    let raw: unknown;
    try {
      const body = await res.json();
      raw = (body as { detail?: unknown }).detail;
      // FastAPI validation errors arrive as an array of issue objects. Errors
      // we raise ourselves may be an object with a machine-readable status.
      message =
        typeof raw === "string"
          ? raw
          : summarizeDetail(raw) ?? messageFromDetail(raw) ?? JSON.stringify(body);
    } catch {
      /* fall back to statusText */
    }
    throw new ApiError(res.status, message, raw);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function summarizeDetail(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const messages = raw
    .map((issue) => (issue as { msg?: string }).msg)
    .filter((m): m is string => typeof m === "string");
  return messages.length > 0 ? messages.join("; ") : null;
}

function messageFromDetail(raw: unknown): string | null {
  if (raw && typeof raw === "object") {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return null;
}

/** Signup no longer returns a session; the address has to be proved first. */
export type PendingVerification = {
  status: "verification_required";
  user_id: string;
  email: string;
};

/** True when a failure is really "finish verifying", not a dead end. */
export function asPendingVerification(error: unknown): PendingVerification | null {
  if (!(error instanceof ApiError)) return null;
  const detail = error.detail;
  if (detail && typeof detail === "object") {
    const d = detail as Partial<PendingVerification>;
    if (d.status === "verification_required" && d.user_id && d.email) {
      return { status: "verification_required", user_id: d.user_id, email: d.email };
    }
  }
  return null;
}

export const api = {
  // --- auth ---
  signup: (email: string, password: string, fullName: string, workspaceName?: string) =>
    request<PendingVerification>(`${CORE}/auth/signup`, {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        full_name: fullName,
        workspace_name: workspaceName || undefined,
      }),
    }),

  /** Submit the emailed code. This is where the first session is issued. */
  verifyEmail: (userId: string, code: string) =>
    request<SessionResponse>(`${CORE}/auth/verify`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, code }),
    }),

  /** Send a fresh code. The server retires the previous one and rate-limits. */
  resendVerification: (userId: string) =>
    request<{ status: string }>(`${CORE}/auth/verify/resend`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),

  /**
   * Which sign-in methods this deployment can actually offer.
   *
   * Google is configured by environment variable, so the button must be driven
   * by the server rather than hardcoded. Rendering it where no client ID is
   * set would send users to a Google error page.
   */
  authMethods: () =>
    request<{ password: boolean; google: boolean }>(`${CORE}/auth/methods`, { method: "GET" }),

  login: (email: string, password: string) =>
    request<SessionResponse>(`${CORE}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  /**
   * Exchange the httpOnly refresh cookie for a fresh access token.
   *
   * The cookie rides along automatically; the readable CSRF cookie is echoed
   * in a header, which a cross-site attacker cannot reproduce because it can
   * trigger requests but never read the response or the cookie jar. A 401 here
   * simply means "not signed in" and is an expected outcome on first visit.
   *
   * Calls are de-duplicated while one is in flight. Rotation invalidates the
   * presented token, so two overlapping refreshes would have the second one
   * arriving with a cookie the first already spent.
   */
  refresh: (): Promise<SessionResponse> => {
    if (!inFlightRefresh) {
      inFlightRefresh = request<SessionResponse>(`${CORE}/auth/refresh`, {
        method: "POST",
        headers: { "x-csrf-token": readCookie(CSRF_COOKIE) ?? "" },
      }).finally(() => {
        inFlightRefresh = null;
      });
    }
    return inFlightRefresh;
  },

  /** Revoke the session server-side so the cookie cannot be replayed. */
  logout: () => request<void>(`${CORE}/auth/logout`, { method: "POST" }),

  /** Exchange a user-level token for a tenant-scoped one. */
  tenantToken: (tenantId: string, getToken: TokenGetter) =>
    request<TokenResponse & { role: string }>(
      `${CORE}/tenancy/token`,
      { method: "POST", body: JSON.stringify({ tenant_id: tenantId }) },
      getToken,
    ),

  myEntitlements: (getToken: TokenGetter) =>
    request<Entitlements>(`${CORE}/entitlements/me`, {}, getToken),

  listContracts: (getToken: TokenGetter) =>
    request<Contract[]>(`${CC}/contracts`, {}, getToken),

  getContract: (id: string, getToken: TokenGetter) =>
    request<Contract>(`${CC}/contracts/${id}`, {}, getToken),

  createContract: (input: CreateContractInput, getToken: TokenGetter) =>
    request<Contract>(`${CC}/contracts`, { method: "POST", body: JSON.stringify(input) }, getToken),

  updateContract: (id: string, input: UpdateContractInput, getToken: TokenGetter) =>
    request<Contract>(
      `${CC}/contracts/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
      getToken,
    ),

  deleteContract: (id: string, getToken: TokenGetter) =>
    request<void>(`${CC}/contracts/${id}`, { method: "DELETE" }, getToken),

  analyze: (id: string, getToken: TokenGetter) =>
    request<Obligation[]>(`${CC}/contracts/${id}/analyze`, { method: "POST" }, getToken),

  listObligations: (id: string, getToken: TokenGetter) =>
    request<Obligation[]>(`${CC}/contracts/${id}/obligations`, {}, getToken),

  createObligation: (
    contractId: string,
    input: CreateObligationInput,
    getToken: TokenGetter,
  ) =>
    request<Obligation>(
      `${CC}/contracts/${contractId}/obligations`,
      { method: "POST", body: JSON.stringify(input) },
      getToken,
    ),

  updateObligation: (id: string, input: UpdateObligationInput, getToken: TokenGetter) =>
    request<Obligation>(
      `${CC}/obligations/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
      getToken,
    ),

  deleteObligation: (id: string, getToken: TokenGetter) =>
    request<void>(`${CC}/obligations/${id}`, { method: "DELETE" }, getToken),

  /** Tenant-wide obligation feed backing the Tasks view. */
  listTenantObligations: (status: ObligationStatus | null, getToken: TokenGetter) =>
    request<ObligationWithContract[]>(
      `${CC}/obligations${status ? `?status=${status}` : ""}`,
      {},
      getToken,
    ),

  // --- documents ---
  listDocuments: (contractId: string, getToken: TokenGetter) =>
    request<ContractDocument[]>(`${CC}/contracts/${contractId}/documents`, {}, getToken),

  uploadDocument: (contractId: string, file: File, getToken: TokenGetter) => {
    const form = new FormData();
    form.append("file", file);
    return request<ContractDocument>(
      `${CC}/contracts/${contractId}/documents`,
      { method: "POST", body: form },
      getToken,
    );
  },

  deleteDocument: (contractId: string, documentId: string, getToken: TokenGetter) =>
    request<void>(
      `${CC}/contracts/${contractId}/documents/${documentId}`,
      { method: "DELETE" },
      getToken,
    ),

  /**
   * Fetch a document as a blob. Downloads are authenticated rather than
   * public URLs, so the bearer token has to travel on the request; the object
   * URL created from the result is revoked by the caller.
   */
  downloadDocument: async (
    contractId: string,
    documentId: string,
    getToken: TokenGetter,
  ): Promise<Blob> => {
    const token = getToken();
    const res = await fetch(
      `${CC}/contracts/${contractId}/documents/${documentId}/download`,
      { headers: token ? { authorization: `Bearer ${token}` } : undefined },
    );
    if (!res.ok) throw new ApiError(res.status, "Could not download this document.");
    return res.blob();
  },

  // --- audit ---
  listAudit: (getToken: TokenGetter) =>
    request<AuditEntry[]>(`${CC}/audit`, {}, getToken),

  // --- billing ---
  listPlans: (getToken: TokenGetter) =>
    request<PlanOption[]>(`${CORE}/billing/plans`, {}, getToken),

  createCheckout: (priceId: string, getToken: TokenGetter) =>
    request<CheckoutSession>(
      `${CORE}/billing/checkout`,
      {
        method: "POST",
        body: JSON.stringify({
          price_id: priceId,
          // Stripe returns the customer here after payment; the session id
          // placeholder is substituted by Stripe itself.
          return_url: `${window.location.origin}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
        }),
      },
      getToken,
    ),

  /** Stripe-hosted portal for managing or cancelling an existing subscription. */
  createPortal: (getToken: TokenGetter) =>
    request<{ url: string }>(
      `${CORE}/billing/portal`,
      {
        method: "POST",
        body: JSON.stringify({ return_url: `${window.location.origin}/settings` }),
      },
      getToken,
    ),

  // --- grant intelligence ---

  /** Null until the tenant has saved a profile, which is a normal first-run state. */
  getProfile: (getToken: TokenGetter) =>
    request<OrgProfile | null>(`${CORE}/grants/profile`, {}, getToken),

  /**
   * Partial update. Only the keys sent are changed, so an autosaving form can
   * send one field without clearing the rest. Saving a field that feeds
   * scoring queues a rescore server-side.
   */
  saveProfile: (input: OrgProfileInput, getToken: TokenGetter) =>
    request<OrgProfile>(
      `${CORE}/grants/profile`,
      { method: "PUT", body: JSON.stringify(input) },
      getToken,
    ),

  eligibilityCodes: async (getToken: TokenGetter) => {
    const res = await request<{ codes: EligibilityCode[] }>(
      `${CORE}/grants/eligibility-codes`,
      {},
      getToken,
    );
    return res.codes;
  },

  /**
   * Precomputed matches, read from stored rows.
   *
   * This never scores anything: the scan job wrote these rows already, so a
   * page load is an indexed read rather than a pass over the whole catalogue.
   */
  listMatches: (
    params: { minScore?: number; savedOnly?: boolean; limit?: number; offset?: number },
    getToken: TokenGetter,
  ) => {
    const q = new URLSearchParams();
    if (params.minScore) q.set("min_score", String(params.minScore));
    if (params.savedOnly) q.set("saved_only", "true");
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return request<MatchPage>(`${CORE}/grants/matches?${q}`, {}, getToken);
  },

  matchSummary: (getToken: TokenGetter) =>
    request<MatchSummary>(`${CORE}/grants/matches/summary`, {}, getToken),

  setMatchState: (
    opportunityId: string,
    state: { saved?: boolean; dismissed?: boolean },
    getToken: TokenGetter,
  ) =>
    request<Record<string, unknown>>(
      `${CORE}/grants/matches/${opportunityId}/state`,
      { method: "POST", body: JSON.stringify(state) },
      getToken,
    ),

  /**
   * Queue a scan. 202 with a job id; the work happens off the request path.
   *
   * Throws ApiError 402 when the plan's monthly scans are exhausted and 409
   * when the profile cannot produce a score yet. Both are expected states with
   * a clear next action, not faults.
   */
  requestScan: (getToken: TokenGetter) =>
    request<ScanRequest>(`${CORE}/grants/scan`, { method: "POST" }, getToken),

  scanStatus: (jobId: string, getToken: TokenGetter) =>
    request<JobStatus>(`${CORE}/grants/scan/${jobId}`, {}, getToken),

  scanUsage: (getToken: TokenGetter) =>
    request<ScanUsage>(`${CORE}/grants/usage`, {}, getToken),

  // --- team -----------------------------------------------------------------

  /**
   * The caller's rank in the active workspace.
   *
   * Asked of the server rather than read from the identity we already hold:
   * that one was captured when the tenant token was minted and does not change
   * if an owner demotes you mid-session. This is only ever used to decide what
   * to render -- every route re-checks server-side, because a hidden button is
   * not an access control.
   */
  myRole: (getToken: TokenGetter) =>
    request<{ tenant_id: string; role: MemberRole }>(`${CORE}/tenancy/me`, {}, getToken),

  listMembers: (getToken: TokenGetter) =>
    request<Member[]>(`${CORE}/tenancy/members`, {}, getToken),

  seats: (getToken: TokenGetter) => request<Seats>(`${CORE}/tenancy/seats`, {}, getToken),

  changeRole: (userId: string, role: MemberRole, getToken: TokenGetter) =>
    request<void>(
      `${CORE}/tenancy/members/${userId}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
      getToken,
    ),

  removeMember: (userId: string, getToken: TokenGetter) =>
    request<void>(`${CORE}/tenancy/members/${userId}`, { method: "DELETE" }, getToken),

  transferOwnership: (userId: string, getToken: TokenGetter) =>
    request<void>(
      `${CORE}/tenancy/members/transfer`,
      { method: "POST", body: JSON.stringify({ user_id: userId }) },
      getToken,
    ),

  listInvites: (getToken: TokenGetter) =>
    request<Invite[]>(`${CORE}/tenancy/invites`, {}, getToken),

  /** Throws ApiError 402 when the plan's seats are already taken. */
  invite: (email: string, role: MemberRole, getToken: TokenGetter) =>
    request<Invite>(
      `${CORE}/tenancy/invites`,
      { method: "POST", body: JSON.stringify({ email, role }) },
      getToken,
    ),

  revokeInvite: (id: string, getToken: TokenGetter) =>
    request<void>(`${CORE}/tenancy/invites/${id}`, { method: "DELETE" }, getToken),

  // --- usage ----------------------------------------------------------------

  /**
   * AI consumption for the workspace. Distinct from `scanUsage`, which reports
   * how much of the plan's scan allowance is left -- quota rather than money.
   */
  usage: (days: number, getToken: TokenGetter) =>
    request<UsageResponse>(`${CORE}/usage/me?days=${days}`, {}, getToken),

  usageBySeat: (days: number, getToken: TokenGetter) =>
    request<ActorUsage[]>(`${CORE}/usage/by-seat?days=${days}`, {}, getToken),
};
