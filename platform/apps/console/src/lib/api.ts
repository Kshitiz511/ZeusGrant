// HTTP client for the Zeus platform.
//
// Same-origin only: every call goes through the Vite/reverse-proxy prefixes
// (/api/core, /api/cc). The bearer token is injected per-request from an
// in-memory getter (never read from storage here) so token handling stays in
// one place (auth.ts) and this module has no ambient security state.

import type {
  Contract,
  CreateContractInput,
  Entitlements,
  Obligation,
  SessionResponse,
  TokenResponse,
} from "./types";

const CORE = "/api/core";
const CC = "/api/cc";

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
  headers.set("content-type", "application/json");
  const token = getToken?.();
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = (body as { detail?: string }).detail ?? JSON.stringify(body);
    } catch {
      /* fall back to statusText */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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

  analyze: (id: string, getToken: TokenGetter) =>
    request<Obligation[]>(`${CC}/contracts/${id}/analyze`, { method: "POST" }, getToken),

  listObligations: (id: string, getToken: TokenGetter) =>
    request<Obligation[]>(`${CC}/contracts/${id}/obligations`, {}, getToken),
};
