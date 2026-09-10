import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

export type PlatformRole = "platform_admin" | "platform_support" | null;

export type AdminAccount = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  org_name: string | null;
  org_type: string | null;
  ein: string | null;
  uei: string | null;
  modules: string[];
  plan: string | null;
  seats: number;
  onboarding_complete: boolean;
  created_at: string;
  last_active: string | null;
  errors: number;
  flagged: boolean;
};

export type AiJobRow = {
  id: string;
  user_id: string | null;
  job_type: string;
  status: string;
  started_at: string;
  duration_ms: number | null;
  model_used: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  error_message: string | null;
  request_summary: Json;
  org_name: string | null;
};

export type ErrorRow = {
  id: string;
  user_id: string | null;
  error_type: string;
  source_function: string | null;
  message: string;
  stacktrace: string | null;
  resolved: boolean;
  resolution_note: string | null;
  created_at: string;
  org_name: string | null;
};

export type AuditRow = {
  id: string;
  user_id: string;
  action: string;
  resource_type: string | null;
  created_at: string;
};

/** Tables the Data Inspector may read. All are owner-scoped by user_id. */
export const INSPECTABLE_TABLES = [
  "org_profiles",
  "person_profiles",
  "org_team_members",
  "grant_records",
  "proposals",
  "compliance_contracts",
  "compliance_obligations",
  "compliance_documents",
  "evidence_vault_files",
  "saved_opportunities",
  "module_subscriptions",
  "subscriptions",
  "usage_counters",
  "email_report_settings",
  "funding_scan_runs",
] as const;
export type InspectableTable = (typeof INSPECTABLE_TABLES)[number];

async function staff() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function roleOf(userId: string): Promise<PlatformRole> {
  const admin = await staff();
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["platform_admin", "platform_support"]);
  const roles = (data ?? []).map((r) => r.role as string);
  if (roles.includes("platform_admin")) return "platform_admin";
  if (roles.includes("platform_support")) return "platform_support";
  return null;
}

function deny(): never {
  throw new Response("Forbidden", { status: 403 });
}

async function requireStaff(userId: string) {
  const role = await roleOf(userId);
  if (!role) deny();
  return role;
}

async function logAdminAction(
  adminId: string,
  action: string,
  metadata: Record<string, Json>,
) {
  const admin = await staff();
  await admin.from("security_audit_log").insert({
    user_id: adminId,
    action,
    resource_type: "admin_panel",
    metadata: metadata as never,
  });
}

/** Which platform role, if any, the signed-in user holds. */
export const getPlatformRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ role: PlatformRole }> => ({
    role: await roleOf(context.userId),
  }));

export type AdminOverview = {
  activeAccounts: number;
  newAccounts30d: number;
  activeUsers30d: number;
  jobsToday: number;
  jobSuccessRate: number;
  errors24h: number;
  jobVolume: { day: string; total: number; failed: number }[];
  signups: { week: string; count: number }[];
  activity: AuditRow[];
  health: { service: string; status: "healthy" | "degraded" | "down"; latencyMs: number | null }[];
};

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminOverview> => {
    await requireStaff(context.userId);
    const admin = await staff();
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    const day = 86_400_000;

    const [profiles, subs, jobs, errors, audit] = await Promise.all([
      admin.from("profiles").select("id, created_at"),
      admin.from("module_subscriptions").select("user_id, status"),
      admin.from("ai_job_log").select("status, started_at").gte("started_at", iso(now - 7 * day)),
      admin.from("platform_error_log").select("id, created_at").gte("created_at", iso(now - day)),
      admin
        .from("security_audit_log")
        .select("id, user_id, action, resource_type, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const activeAccounts = new Set(
      (subs.data ?? [])
        .filter((s) => ["active", "trialing", "past_due"].includes(s.status))
        .map((s) => s.user_id),
    ).size;

    const jobRows = jobs.data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const todays = jobRows.filter((j) => j.started_at.slice(0, 10) === today);
    const succeeded = todays.filter((j) => j.status === "success").length;

    const jobVolume = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - (6 - i) * day).toISOString().slice(0, 10);
      const forDay = jobRows.filter((j) => j.started_at.slice(0, 10) === d);
      return {
        day: d.slice(5),
        total: forDay.length,
        failed: forDay.filter((j) => j.status !== "success" && j.status !== "running").length,
      };
    });

    const signups = Array.from({ length: 12 }, (_, i) => {
      const start = now - (11 - i) * 7 * day;
      const end = start + 7 * day;
      return {
        week: new Date(start).toISOString().slice(5, 10),
        count: (profiles.data ?? []).filter((p) => {
          const t = new Date(p.created_at).getTime();
          return t >= start && t < end;
        }).length,
      };
    });

    const activeUsers30d = new Set(
      (
        await admin
          .from("security_audit_log")
          .select("user_id")
          .gte("created_at", iso(now - 30 * day))
      ).data?.map((r) => r.user_id) ?? [],
    ).size;

    const dbStart = Date.now();
    await admin.from("platform_config").select("key").limit(1);
    const dbLatency = Date.now() - dbStart;

    const health: AdminOverview["health"] = [
      {
        service: "Database",
        status: dbLatency > 3000 ? "degraded" : "healthy",
        latencyMs: dbLatency,
      },
      { service: "File storage", status: "healthy", latencyMs: null },
      {
        service: "AI gateway",
        status: process.env["LOVABLE_API_KEY"] ? "healthy" : "down",
        latencyMs: null,
      },
      {
        service: "Payments",
        status: process.env["STRIPE_SECRET_KEY"] ? "healthy" : "down",
        latencyMs: null,
      },
      {
        service: "Email delivery",
        status: process.env["RESEND_API_KEY"] ? "healthy" : "degraded",
        latencyMs: null,
      },
    ];

    return {
      activeAccounts,
      newAccounts30d: (profiles.data ?? []).filter(
        (p) => new Date(p.created_at).getTime() > now - 30 * day,
      ).length,
      activeUsers30d,
      jobsToday: todays.length,
      jobSuccessRate: todays.length ? Math.round((succeeded / todays.length) * 100) : 100,
      errors24h: (errors.data ?? []).length,
      jobVolume,
      signups,
      activity: (audit.data ?? []) as AuditRow[],
      health,
    };
  });

export const listAdminAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { search?: string } | undefined) => ({
    search: (data?.search ?? "").trim().toLowerCase().slice(0, 120),
  }))
  .handler(async ({ context, data }): Promise<AdminAccount[]> => {
    await requireStaff(context.userId);
    const admin = await staff();

    const [profiles, orgs, subs, team, errors, flags, audit] = await Promise.all([
      admin.from("profiles").select("id, email, full_name, created_at"),
      admin
        .from("org_profiles")
        .select("user_id, org_name, org_type, ein, uei, onboarding_complete"),
      admin.from("module_subscriptions").select("user_id, module, plan, status"),
      admin.from("org_team_members").select("user_id"),
      admin.from("platform_error_log").select("user_id").eq("resolved", false),
      admin.from("admin_account_flags").select("account_user_id, flagged"),
      admin
        .from("security_audit_log")
        .select("user_id, created_at")
        .order("created_at", { ascending: false })
        .limit(2000),
    ]);

    const lastActive = new Map<string, string>();
    for (const row of audit.data ?? []) {
      if (!lastActive.has(row.user_id)) lastActive.set(row.user_id, row.created_at);
    }

    const rows: AdminAccount[] = (profiles.data ?? []).map((p) => {
      const org = (orgs.data ?? []).find((o) => o.user_id === p.id);
      const mine = (subs.data ?? []).filter(
        (s) => s.user_id === p.id && ["active", "trialing", "past_due"].includes(s.status),
      );
      return {
        user_id: p.id,
        email: p.email,
        full_name: p.full_name,
        org_name: org?.org_name ?? null,
        org_type: org?.org_type ?? null,
        ein: org?.ein ?? null,
        uei: org?.uei ?? null,
        modules: mine.map((m) => m.module),
        plan: mine[0]?.plan ?? null,
        seats: 1 + (team.data ?? []).filter((t) => t.user_id === p.id).length,
        onboarding_complete: org?.onboarding_complete ?? false,
        created_at: p.created_at,
        last_active: lastActive.get(p.id) ?? null,
        errors: (errors.data ?? []).filter((e) => e.user_id === p.id).length,
        flagged: (flags.data ?? []).some((f) => f.account_user_id === p.id && f.flagged),
      };
    });

    const q = data.search;
    const filtered = q
      ? rows.filter((r) =>
          [r.email, r.full_name, r.org_name, r.ein, r.uei]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : rows;

    return filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  });

export type AdminAccountDetail = {
  account: AdminAccount;
  org: Record<string, Json> | null;
  modules: Record<string, Json>[];
  subscription: Record<string, Json> | null;
  team: Record<string, Json>[];
  audit: AuditRow[];
  jobs: AiJobRow[];
  errors: ErrorRow[];
  note: string | null;
};

export const getAdminAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) => ({ userId: String(data?.userId ?? "") }))
  .handler(async ({ context, data }): Promise<AdminAccountDetail> => {
    await requireStaff(context.userId);
    const admin = await staff();
    const uid = data.userId;

    await logAdminAction(context.userId, "admin_data_access", { account: uid, view: "overview" });

    const [profile, org, modules, sub, team, audit, jobs, errors, flag] = await Promise.all([
      admin.from("profiles").select("*").eq("id", uid).maybeSingle(),
      admin.from("org_profiles").select("*").eq("user_id", uid).maybeSingle(),
      admin.from("module_subscriptions").select("*").eq("user_id", uid),
      admin
        .from("subscriptions")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("org_team_members").select("*").eq("user_id", uid),
      admin
        .from("security_audit_log")
        .select("id, user_id, action, resource_type, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("ai_job_log")
        .select("*")
        .eq("user_id", uid)
        .order("started_at", { ascending: false })
        .limit(100),
      admin
        .from("platform_error_log")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false })
        .limit(100),
      admin.from("admin_account_flags").select("*").eq("account_user_id", uid).maybeSingle(),
    ]);

    const account: AdminAccount = {
      user_id: uid,
      email: profile.data?.email ?? null,
      full_name: profile.data?.full_name ?? null,
      org_name: org.data?.org_name ?? null,
      org_type: org.data?.org_type ?? null,
      ein: org.data?.ein ?? null,
      uei: org.data?.uei ?? null,
      modules: (modules.data ?? [])
        .filter((m) => ["active", "trialing", "past_due"].includes(m.status))
        .map((m) => m.module),
      plan: (modules.data ?? [])[0]?.plan ?? null,
      seats: 1 + (team.data ?? []).length,
      onboarding_complete: org.data?.onboarding_complete ?? false,
      created_at: profile.data?.created_at ?? new Date().toISOString(),
      last_active: (audit.data ?? [])[0]?.created_at ?? null,
      errors: (errors.data ?? []).filter((e) => !e.resolved).length,
      flagged: flag.data?.flagged ?? false,
    };

    return {
      account,
      org: (org.data ?? null) as Record<string, Json> | null,
      modules: (modules.data ?? []) as Record<string, Json>[],
      subscription: (sub.data ?? null) as Record<string, Json> | null,
      team: (team.data ?? []) as Record<string, Json>[],
      audit: (audit.data ?? []) as AuditRow[],
      jobs: (jobs.data ?? []).map((j) => ({ ...j, org_name: org.data?.org_name ?? null })),
      errors: (errors.data ?? []).map((e) => ({ ...e, org_name: org.data?.org_name ?? null })),

      note: flag.data?.note ?? null,
    };
  });

export const inspectAccountTable = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; table: string }) => {
    const table = String(data?.table ?? "");
    if (!INSPECTABLE_TABLES.includes(table as InspectableTable)) {
      throw new Error("Table is not available in the inspector");
    }
    return { userId: String(data?.userId ?? ""), table: table as InspectableTable };
  })
  .handler(async ({ context, data }): Promise<Record<string, Json>[]> => {
    await requireStaff(context.userId);
    const admin = await staff();
    await logAdminAction(context.userId, "admin_data_access", {
      account: data.userId,
      table: data.table,
    });
    const { data: rows, error } = await admin
      .from(data.table)
      .select("*")
      .eq("user_id", data.userId)
      .limit(200);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Record<string, Json>[];
  });

export const listAiJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { status?: string; jobType?: string } | undefined) => ({
    status: data?.status ?? "all",
    jobType: data?.jobType ?? "all",
  }))
  .handler(async ({ context, data }): Promise<AiJobRow[]> => {
    await requireStaff(context.userId);
    const admin = await staff();
    let query = admin
      .from("ai_job_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(300);
    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.jobType !== "all") query = query.eq("job_type", data.jobType);
    const { data: rows } = await query;
    const orgs = await admin.from("org_profiles").select("user_id, org_name");
    const names = new Map((orgs.data ?? []).map((o) => [o.user_id, o.org_name]));
    return (rows ?? []).map((r) => ({
      ...r,
      org_name: r.user_id ? (names.get(r.user_id) ?? null) : null,
    })) as AiJobRow[];
  });

export const listPlatformErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { resolved?: string } | undefined) => ({
    resolved: data?.resolved ?? "open",
  }))
  .handler(async ({ context, data }): Promise<ErrorRow[]> => {
    await requireStaff(context.userId);
    const admin = await staff();
    let query = admin
      .from("platform_error_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.resolved === "open") query = query.eq("resolved", false);
    if (data.resolved === "resolved") query = query.eq("resolved", true);
    const { data: rows } = await query;
    const orgs = await admin.from("org_profiles").select("user_id, org_name");
    const names = new Map((orgs.data ?? []).map((o) => [o.user_id, o.org_name]));
    return (rows ?? []).map((r) => ({
      ...r,
      org_name: r.user_id ? (names.get(r.user_id) ?? null) : null,
    })) as ErrorRow[];
  });

export const resolvePlatformErrors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[]; note?: string }) => ({
    ids: (data?.ids ?? []).map(String).slice(0, 200),
    note: (data?.note ?? "").slice(0, 500),
  }))
  .handler(async ({ context, data }) => {
    const role = await requireStaff(context.userId);
    if (role !== "platform_admin") deny();
    const admin = await staff();
    await admin
      .from("platform_error_log")
      .update({
        resolved: true,
        resolved_by: context.userId,
        resolved_at: new Date().toISOString(),
        resolution_note: data.note || null,
      })
      .in("id", data.ids);
    await logAdminAction(context.userId, "admin_support_action", {
      action: "resolve_errors",
      count: data.ids.length,
    });
    return { ok: true };
  });

export type PlatformSettings = {
  feature_flags: Record<string, boolean>;
  rate_limits: Record<string, number>;
  announcement_banner: string;
};

export const getPlatformSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformSettings> => {
    await requireStaff(context.userId);
    const admin = await staff();
    const { data } = await admin.from("platform_config").select("key, value");
    const map = new Map((data ?? []).map((r) => [r.key, r.value]));
    return {
      feature_flags: (map.get("feature_flags") ?? {}) as Record<string, boolean>,
      rate_limits: (map.get("rate_limits") ?? {}) as Record<string, number>,
      announcement_banner: String(map.get("announcement_banner") ?? ""),
    };
  });

export const updatePlatformSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<PlatformSettings>) => data ?? {})
  .handler(async ({ context, data }) => {
    const role = await requireStaff(context.userId);
    if (role !== "platform_admin") deny();
    const admin = await staff();
    const updates: { key: string; value: unknown }[] = [];
    if (data.feature_flags) updates.push({ key: "feature_flags", value: data.feature_flags });
    if (data.rate_limits) updates.push({ key: "rate_limits", value: data.rate_limits });
    if (data.announcement_banner !== undefined)
      updates.push({ key: "announcement_banner", value: data.announcement_banner });
    for (const u of updates) {
      await admin.from("platform_config").upsert({
        key: u.key,
        value: u.value as never,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      });
    }
    await logAdminAction(context.userId, "admin_support_action", { action: "update_settings" });
    return { ok: true };
  });

export type SupportAction =
  | "reset_onboarding"
  | "send_password_reset"
  | "clear_rate_limit"
  | "flag_account"
  | "unflag_account"
  | "export_account_data";

export const runSupportAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; action: SupportAction; reason?: string }) => ({
    userId: String(data?.userId ?? ""),
    action: data.action,
    reason: (data?.reason ?? "").slice(0, 500),
  }))
  .handler(async ({ context, data }): Promise<{ ok: true; message: string; payload: Json | null }> => {
    const role = await requireStaff(context.userId);
    const admin = await staff();
    const adminOnly: SupportAction[] = ["reset_onboarding", "send_password_reset"];
    if (adminOnly.includes(data.action) && role !== "platform_admin") deny();

    await logAdminAction(context.userId, "admin_support_action", {
      account: data.userId,
      action: data.action,
      reason: data.reason,
    });

    switch (data.action) {
      case "reset_onboarding": {
        await admin
          .from("org_profiles")
          .update({ onboarding_complete: false, onboarding_step: 1 })
          .eq("user_id", data.userId);
        return { ok: true, message: "Onboarding reset for this account.", payload: null };
      }
      case "send_password_reset": {
        const { data: profile } = await admin
          .from("profiles")
          .select("email")
          .eq("id", data.userId)
          .maybeSingle();
        if (!profile?.email) throw new Error("No email on file for this account");
        const { error } = await admin.auth.resetPasswordForEmail(profile.email);
        if (error) throw new Error(error.message);
        return { ok: true, message: `Password reset email sent to ${profile.email}.`, payload: null };
      }
      case "clear_rate_limit": {
        await admin.from("api_rate_log").delete().eq("user_id", data.userId);
        return { ok: true, message: "Rate limit counters cleared.", payload: null };
      }
      case "flag_account":
      case "unflag_account": {
        await admin.from("admin_account_flags").upsert(
          {
            account_user_id: data.userId,
            flagged: data.action === "flag_account",
            note: data.reason || null,
            created_by: context.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "account_user_id" },
        );
        return {
          ok: true,
          message: data.action === "flag_account" ? "Account flagged." : "Flag removed.",
          payload: null,
        };
      }
      case "export_account_data": {
        const payload: Record<string, Json> = {};
        for (const table of INSPECTABLE_TABLES) {
          const { data: rows } = await admin.from(table).select("*").eq("user_id", data.userId);
          payload[table] = (rows ?? []) as Json;
        }
        return { ok: true, message: "Export ready.", payload };
      }
      default:
        throw new Error("Unknown action");
    }
  });
