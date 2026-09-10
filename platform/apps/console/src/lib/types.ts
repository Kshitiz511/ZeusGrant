// Domain types mirrored from the backend Pydantic models. Kept minimal and
// explicit so the UI is fully typed end-to-end.

export type TokenResponse = { access_token: string; token_type: string };

export type SessionResponse = {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  tenants: { tenant_id: string; name: string; slug: string; role: string }[];
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
  created_at?: string;
};

export type Priority = "low" | "medium" | "high";

export type Obligation = {
  id: string;
  contract_id: string;
  description: string;
  due_date: string | null;
  responsible: string | null;
  priority: Priority;
  status: string;
  source: string;
};

export type CreateContractInput = {
  title: string;
  counterparty?: string;
  body: string;
};
