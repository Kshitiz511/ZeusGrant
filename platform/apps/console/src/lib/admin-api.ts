// HTTP client for the platform-admin surface.
//
// Kept apart from `api.ts` deliberately. Everything here is gated server-side
// on `require_platform_admin`, and that boundary is easier to keep honest when
// the two groups of calls do not sit in one file and drift into each other.
//
// Shapes are mostly declared as row-ish records rather than exhaustive
// interfaces: these endpoints return database rows, and re-declaring every
// column here would create a second schema to keep in sync with the first.
// The fields the UI actually reads are typed; the rest travel as unknown.

import { adminRequest } from "./api";
import type { TokenGetter } from "./api";

const CORE = "/api/core";

export type TenantStatus = "active" | "suspended" | "deleted";

export interface AdminTenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  owner_user_id: string | null;
  stripe_customer_id: string | null;
  member_count?: number;
  module_count?: number;
  override_count?: number;
  created_at?: string;
}

export interface TenantPage {
  tenants: AdminTenant[];
  total: number;
  limit: number;
  offset: number;
}

export interface LimitOverride {
  limit_key: string;
  limit_value: number | null;
  reason?: string | null;
  module_id?: string | null;
}

export interface TenantDetail {
  tenant: AdminTenant;
  members: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  limit_overrides: LimitOverride[];
  entitlements: Record<string, unknown>;
}

export interface AdminPlan {
  plan_id: string;
  module_id: string;
  name: string;
  monthly_cents: number | null;
  annual_cents: number | null;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annual: string | null;
  is_active: boolean;
  limits?: Record<string, number | null>;
}

export interface PlanCatalog {
  plans: AdminPlan[];
  /** Active plans with no Stripe price — invisible on the storefront. */
  unsellable_active_plans: string[];
  note?: string;
}

export interface ModelPrice {
  model: string;
  input_per_million_usd: string | number;
  output_per_million_usd: string | number;
  updated_at?: string;
}

export interface ModelCatalog {
  models: ModelPrice[];
  /** Models being called with no price: their spend is invisible everywhere. */
  unpriced_models: string[];
}

export interface AdminJob {
  id: string;
  tenant_id: string | null;
  module_id: string | null;
  kind: string;
  status: string;
  attempts?: number;
  created_at?: string;
  updated_at?: string;
  lease_expires_at?: string | null;
  last_error?: string | null;
}

export interface JobPage {
  jobs: AdminJob[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminSetting {
  key: string;
  label: string;
  group: string;
  is_secret: boolean;
  source: string;
  value: string | null;
  help: string | null;
  value_type: string;
  minimum: number | null;
  maximum: number | null;
}

export interface AuditEntryRow {
  id?: string;
  action: string;
  actor_user_id?: string | null;
  target?: string | null;
  created_at?: string;
  detail?: Record<string, unknown> | null;
}

export const adminApi = {
  // --- tenants -------------------------------------------------------------
  tenants: (
    params: { status?: string; search?: string; limit?: number; offset?: number },
    getToken: TokenGetter,
  ) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.search) q.set("search", params.search);
    q.set("limit", String(params.limit ?? 50));
    q.set("offset", String(params.offset ?? 0));
    return adminRequest<TenantPage>(`${CORE}/admin/tenants?${q}`, {}, getToken);
  },

  tenant: (id: string, getToken: TokenGetter) =>
    adminRequest<TenantDetail>(`${CORE}/admin/tenants/${id}`, {}, getToken),

  setTenantStatus: (
    id: string,
    status: "active" | "suspended",
    reason: string,
    getToken: TokenGetter,
  ) =>
    adminRequest<unknown>(
      `${CORE}/admin/tenants/${id}/status`,
      { method: "POST", body: JSON.stringify({ status, reason }) },
      getToken,
    ),

  tenantLimits: (id: string, getToken: TokenGetter) =>
    adminRequest<{
      tenant_id: string;
      overrides: LimitOverride[];
      available_keys: string[];
    }>(`${CORE}/admin/tenants/${id}/limits`, {}, getToken),

  setTenantLimit: (
    id: string,
    key: string,
    limitValue: number | null,
    reason: string,
    getToken: TokenGetter,
  ) =>
    adminRequest<unknown>(
      `${CORE}/admin/tenants/${id}/limits/${encodeURIComponent(key)}`,
      { method: "PUT", body: JSON.stringify({ limit_value: limitValue, reason }) },
      getToken,
    ),

  clearTenantLimit: (id: string, key: string, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/tenants/${id}/limits/${encodeURIComponent(key)}`,
      { method: "DELETE" },
      getToken,
    ),

  // --- catalogue -----------------------------------------------------------
  plans: (getToken: TokenGetter) =>
    adminRequest<PlanCatalog>(`${CORE}/admin/plans`, {}, getToken),

  updatePlan: (planId: string, patch: Partial<AdminPlan>, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/plans/${planId}`,
      { method: "PATCH", body: JSON.stringify(patch) },
      getToken,
    ),

  setPlanLimits: (
    planId: string,
    limits: Record<string, number | null>,
    getToken: TokenGetter,
  ) =>
    adminRequest<unknown>(
      `${CORE}/admin/plans/${planId}/limits`,
      { method: "PUT", body: JSON.stringify({ limits }) },
      getToken,
    ),

  models: (getToken: TokenGetter) =>
    adminRequest<ModelCatalog>(`${CORE}/admin/models`, {}, getToken),

  setModelPrice: (
    model: string,
    input: string,
    output: string,
    getToken: TokenGetter,
  ) =>
    adminRequest<unknown>(
      `${CORE}/admin/models/${encodeURIComponent(model)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          input_per_million_usd: input,
          output_per_million_usd: output,
        }),
      },
      getToken,
    ),

  deleteModelPrice: (model: string, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/models/${encodeURIComponent(model)}`,
      { method: "DELETE" },
      getToken,
    ),

  // --- queue ---------------------------------------------------------------
  jobs: (
    params: { status?: string; module_id?: string; stuck?: boolean; limit?: number },
    getToken: TokenGetter,
  ) => {
    const q = new URLSearchParams();
    if (params.status) q.set("status", params.status);
    if (params.module_id) q.set("module_id", params.module_id);
    if (params.stuck) q.set("stuck", "true");
    q.set("limit", String(params.limit ?? 50));
    return adminRequest<JobPage>(`${CORE}/admin/jobs?${q}`, {}, getToken);
  },

  queueHealth: (getToken: TokenGetter) =>
    adminRequest<Record<string, unknown>>(`${CORE}/admin/jobs/health`, {}, getToken),

  retryJob: (jobId: string, getToken: TokenGetter) =>
    adminRequest<unknown>(`${CORE}/admin/jobs/${jobId}/retry`, { method: "POST" }, getToken),

  cancelJob: (jobId: string, reason: string, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/jobs/${jobId}/cancel`,
      { method: "POST", body: JSON.stringify({ reason }) },
      getToken,
    ),

  // --- config and audit ----------------------------------------------------
  settings: (getToken: TokenGetter) =>
    adminRequest<{ settings: AdminSetting[] }>(`${CORE}/admin/settings`, {}, getToken),

  putSetting: (key: string, value: string, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/settings/${key}`,
      { method: "PUT", body: JSON.stringify({ value }) },
      getToken,
    ),

  deleteSetting: (key: string, getToken: TokenGetter) =>
    adminRequest<unknown>(`${CORE}/admin/settings/${key}`, { method: "DELETE" }, getToken),

  cachePrefixes: (getToken: TokenGetter) =>
    adminRequest<Record<string, unknown>>(`${CORE}/admin/cache/prefixes`, {}, getToken),

  flushCache: (prefix: string, getToken: TokenGetter) =>
    adminRequest<unknown>(
      `${CORE}/admin/cache/flush`,
      { method: "POST", body: JSON.stringify({ prefix }) },
      getToken,
    ),

  audit: (limit: number, getToken: TokenGetter) =>
    adminRequest<{ entries: AuditEntryRow[] }>(
      `${CORE}/admin/audit?limit=${limit}`,
      {},
      getToken,
    ),
};
