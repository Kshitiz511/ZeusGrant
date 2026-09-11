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
  AuditEntry,
  CheckoutSession,
  Contract,
  ContractDocument,
  CreateContractInput,
  CreateObligationInput,
  Entitlements,
  Obligation,
  ObligationStatus,
  ObligationWithContract,
  PlanOption,
  SessionResponse,
  TokenResponse,
  UpdateContractInput,
  UpdateObligationInput,
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
    let detail = res.statusText;
    try {
      const body = await res.json();
      const raw = (body as { detail?: unknown }).detail;
      // FastAPI validation errors arrive as an array of issue objects.
      detail = typeof raw === "string" ? raw : summarizeDetail(raw) ?? JSON.stringify(body);
    } catch {
      /* fall back to statusText */
    }
    throw new ApiError(res.status, detail);
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

export const api = {
  // --- auth ---
  signup: (email: string, password: string, workspaceName?: string) =>
    request<SessionResponse>(`${CORE}/auth/signup`, {
      method: "POST",
      body: JSON.stringify({ email, password, workspace_name: workspaceName || undefined }),
    }),

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
};
