// React Query bindings for the platform-admin surface.
//
// Every hook here is `enabled` on `isPlatformAdmin`. That is not a security
// control -- the server re-checks each route -- it exists so a signed-in
// ordinary user does not fire a screenful of requests that all 403.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "./admin-api";
import type { AdminPlan } from "./admin-api";
import { useAuth } from "./auth";
import { useMyRole } from "./hooks";

/**
 * Whether the signed-in user administers the platform, not just their tenant.
 *
 * Read from the server rather than decoded from the token: revoking the grant
 * has to take effect on the next request, not whenever the token expires.
 */
export function useIsPlatformAdmin() {
  const { data, isLoading } = useMyRole();
  return { isPlatformAdmin: data?.platform_admin === true, isLoading };
}

function useAdminQuery<T>(key: unknown[], fn: () => Promise<T>, staleTime = 30_000) {
  const { isPlatformAdmin } = useIsPlatformAdmin();
  return useQuery({
    queryKey: ["admin", ...key],
    queryFn: fn,
    enabled: isPlatformAdmin,
    staleTime,
  });
}

export function useAdminTenants(params: { status?: string; search?: string; offset?: number }) {
  const { getToken } = useAuth();
  return useAdminQuery(["tenants", params], () => adminApi.tenants(params, getToken));
}

export function useAdminTenant(tenantId: string | null) {
  const { getToken } = useAuth();
  const { isPlatformAdmin } = useIsPlatformAdmin();
  return useQuery({
    queryKey: ["admin", "tenant", tenantId],
    queryFn: () => adminApi.tenant(tenantId!, getToken),
    enabled: isPlatformAdmin && !!tenantId,
    staleTime: 10_000,
  });
}

export function useSetTenantStatus() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; status: "active" | "suspended"; reason: string }) =>
      adminApi.setTenantStatus(v.id, v.status, v.reason, getToken),
    // Suspension changes what the tenant list says and what the detail pane
    // shows, and it writes an audit row. Invalidating all three keeps the
    // audit view honest without a manual refresh.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["admin", "tenant"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminPlans() {
  const { getToken } = useAuth();
  return useAdminQuery(["plans"], () => adminApi.plans(getToken), 60_000);
}

export function useUpdatePlan() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { planId: string; patch: Partial<AdminPlan> }) =>
      adminApi.updatePlan(v.planId, v.patch, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "plans"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminModels() {
  const { getToken } = useAuth();
  return useAdminQuery(["models"], () => adminApi.models(getToken), 60_000);
}

export function useSetModelPrice() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { model: string; input: string; output: string }) =>
      adminApi.setModelPrice(v.model, v.input, v.output, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "models"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminJobs(params: { status?: string; stuck?: boolean }) {
  const { getToken } = useAuth();
  // Short stale time: this is the screen someone refreshes during an incident,
  // and a two-minute-old queue is worse than no queue.
  return useAdminQuery(["jobs", params], () => adminApi.jobs(params, getToken), 5_000);
}

export function useQueueHealth() {
  const { getToken } = useAuth();
  return useAdminQuery(["queue-health"], () => adminApi.queueHealth(getToken), 5_000);
}

export function useJobAction() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { jobId: string; action: "retry" | "cancel"; reason?: string }) =>
      v.action === "retry"
        ? adminApi.retryJob(v.jobId, getToken)
        : adminApi.cancelJob(v.jobId, v.reason ?? "cancelled from admin console", getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "jobs"] });
      qc.invalidateQueries({ queryKey: ["admin", "queue-health"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminSettings() {
  const { getToken } = useAuth();
  return useAdminQuery(["settings"], () => adminApi.settings(getToken), 60_000);
}

export function usePutSetting() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; value: string }) =>
      adminApi.putSetting(v.key, v.value, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["admin", "audit"] });
    },
  });
}

export function useAdminAudit(limit = 100) {
  const { getToken } = useAuth();
  return useAdminQuery(["audit", limit], () => adminApi.audit(limit, getToken), 10_000);
}
