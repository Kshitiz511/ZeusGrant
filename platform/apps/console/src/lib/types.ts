// Domain types mirrored from the backend Pydantic models. Kept minimal and
// explicit so the UI is fully typed end-to-end.

export type TokenResponse = { access_token: string; token_type: string };

export type SessionResponse = {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  tenants: { tenant_id: string; name: string; slug: string; role: string }[];
  csrf_token: string;
};

export type ModuleEntitlement = {
  status: string;
  limits?: Record<string, unknown> | null;
};

export type Entitlements = {
  tenant_id: string;
  modules: Record<string, ModuleEntitlement>;
};

export type Contract = {
  id: string;
  tenant_id: string;
  title: string;
  counterparty: string | null;
  body: string | null;
  status?: string;
  body_source?: "manual" | "document";
  last_analyzed_at?: string | null;
  created_at?: string;
};

export type Priority = "low" | "medium" | "high";

export type ObligationStatus = "open" | "in_progress" | "done";

export type Obligation = {
  id: string;
  contract_id: string;
  description: string;
  due_date: string | null;
  responsible: string | null;
  priority: Priority;
  status: ObligationStatus;
  source: string;
};

/** Obligation as returned by the tenant-wide feed, joined to its contract. */
export type ObligationWithContract = Obligation & { contract_title: string };

export type ContractDocument = {
  id: string;
  tenant_id: string;
  contract_id: string;
  filename: string;
  content_type: string;
  byte_size: number;
  checksum: string;
  extracted_chars: number;
  created_at?: string;
};

export type AuditEntry = {
  id: number;
  tenant_id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  created_at?: string;
};

export type CreateContractInput = {
  title: string;
  counterparty?: string;
  body: string;
};

/** Partial update — only the keys present are sent to the server. */
export type UpdateContractInput = Partial<{
  title: string;
  counterparty: string | null;
  body: string;
  status: string;
}>;

export type CreateObligationInput = {
  description: string;
  due_date?: string | null;
  responsible?: string | null;
  priority?: Priority;
};

export type UpdateObligationInput = Partial<{
  description: string;
  due_date: string | null;
  responsible: string | null;
  priority: Priority;
  status: ObligationStatus;
}>;

/** Accepted upload formats, mirrored from the service's allowlist. */
export const ACCEPTED_UPLOAD_TYPES = ".pdf,.docx,.txt,.md";

// --- billing ---------------------------------------------------------------

/** A purchasable plan. Limits are plan-specific, so the shape is open. */
export type PlanOption = {
  plan_id: string;
  module_id: string;
  name: string;
  monthly_cents: number | null;
  annual_cents: number | null;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annual: string | null;
  limits: Record<string, number | string | null>;
};

export type CheckoutSession = {
  client_secret: string | null;
  id: string | null;
};
