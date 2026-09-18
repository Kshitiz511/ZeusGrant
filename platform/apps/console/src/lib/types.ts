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

// --- grant intelligence -----------------------------------------------------

/**
 * The organisation profile that scoring runs against.
 *
 * Mirrors ProfileOut in the grants router. Nearly everything is nullable
 * because the profile is filled in over time. `is_scoreable` is the server's
 * own verdict on whether there is enough here to run a scan, so the UI never
 * reimplements that rule and cannot drift from it.
 */
export type OrgProfile = {
  tenant_id: string;
  legal_name: string | null;
  ein: string | null;
  applicant_class: string | null;
  eligibility_codes: string[];
  home_state: string | null;
  operating_states: string[];
  mission: string | null;
  focus_areas: string[];
  populations_served: string[];
  award_min: number | null;
  award_max: number | null;
  annual_budget: number | null;
  can_cost_share: boolean | null;
  is_scoreable: boolean;
};

export type OrgProfileInput = Partial<Omit<OrgProfile, "tenant_id" | "is_scoreable">>;

/**
 * A scored opportunity.
 *
 * `reasons` carries why it scored what it scored, straight from the SQL
 * scorer. It is displayed rather than hidden: a number with no explanation is
 * exactly what made the legacy fit score untrustworthy.
 */
export type Match = {
  /** The opportunity id. This is what match-state calls are keyed on. */
  id: string;
  match_id: string;
  title: string;
  agency_name: string | null;
  agency_code: string | null;
  source: string;
  source_url: string | null;
  opportunity_number: string | null;
  score: number;
  reasons: Record<string, number | string | boolean | null> | null;
  scorer_version: string | null;
  award_floor: number | null;
  award_ceiling: number | null;
  cost_sharing_required: boolean | null;
  is_forecast: boolean;
  posted_on: string | null;
  closes_on: string | null;
  saved_at: string | null;
  dismissed_at: string | null;
  first_seen_at: string | null;
  scored_at: string | null;
};

export type MatchPage = {
  matches: Match[];
  total: number;
  /** What the plan allows this tenant to see, so the UI can say "25 of 312". */
  visible_limit: number | null;
  truncated: boolean;
  offset: number;
};

// `limit` and `remaining` are null when the plan states no ceiling, which is
// how every enterprise plan is configured. Do not coerce them to 0.
export type ScanUsage = { used: number; limit: number | null; remaining: number | null };

export type MatchSummary = {
  /** Matches still in play, i.e. not dismissed. */
  active: number;
  saved: number;
  dismissed: number;
  /** Matches scoring 70 or above — the ones worth reading first. */
  strong: number;
  last_scored_at: string | null;
  scans: ScanUsage;
};

export type ScanRequest = {
  job_id: string;
  status: string;
  /** True when this collapsed into a scan already running, so no quota was spent. */
  already_running: boolean;
  scans_used: number;
  scans_limit: number | null;
};

export type JobState = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export type JobStatus = {
  id: string;
  kind: string;
  status: JobState;
  progress_done: number | null;
  progress_total: number | null;
  result: Record<string, number | string | null> | null;
  last_error: string | null;
};

export type EligibilityCode = {
  code: string;
  description: string;
  applicant_class: string | null;
};

// --- team and membership ----------------------------------------------------

/**
 * The ranks that mean something. Mirrors the server's ladder: owner > admin >
 * member. `viewer` exists in the database enum but no screen offers it yet, so
 * it is deliberately absent rather than half-supported.
 */
export type MemberRole = "owner" | "admin" | "member";

export type Member = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: MemberRole;
  created_at: string | null;
};

export type Invite = {
  id: string;
  email: string;
  role: MemberRole;
  expires_at: string | null;
  created_at: string | null;
  invited_by_email: string | null;
  /**
   * Present only on creation. Email delivery is unreliable in production right
   * now, so the admin is handed the link to pass on themselves rather than
   * being told to wait for a message that may never arrive.
   */
  accept_url?: string | null;
  email_sent?: boolean | null;
};

export type Seats = {
  used: number;
  pending: number;
  /** `null` means unlimited — the convention used throughout plan limits. */
  limit: number | null;
  remaining: number | null;
};

// --- AI usage ---------------------------------------------------------------

/**
 * One usage rollup.
 *
 * The nullability of `cost_usd` is load-bearing: it means "unknown", never
 * "free". `unpriced_calls` counts the calls that contributed nothing to the
 * figure, so an incomplete total can be shown as incomplete instead of as a
 * confident number that happens to be wrong.
 */
export type UsageTotals = {
  calls: number;
  failures: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  unpriced_calls: number;
};

export type ActorUsage = UsageTotals & {
  actor_id: string | null;
  email: string | null;
  full_name: string | null;
};

export type ModuleUsage = UsageTotals & { module_id: string };

export type UsageDay = {
  day: string;
  calls: number;
  total_tokens: number;
  cost_usd: number | null;
  unpriced_calls: number;
};

export type UsageResponse = {
  since: string;
  until: string;
  totals: UsageTotals;
  by_module: ModuleUsage[];
  series: UsageDay[];
};
