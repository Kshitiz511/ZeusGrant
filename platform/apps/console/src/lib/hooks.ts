import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { ModuleId } from "./modules";
import type {
  CreateContractInput,
  CreateObligationInput,
  MemberRole,
  ObligationStatus,
  OrgProfileInput,
  UpdateContractInput,
  UpdateObligationInput,
} from "./types";

// React Query gives us the "browser-based caching" layer: responses are cached
// per query key, deduped across components, and served stale-while-revalidate.
// This cuts redundant calls to the (serverless, pay-per-invoke) backend — the
// cost-effective default. staleTime is generous for lists that rarely change.

/**
 * Subscription states that still grant access.
 *
 * ``past_due`` counts: cutting a customer off the moment a card fails loses
 * their work over a billing problem they can usually fix in a minute. Billing
 * chases the payment; the product keeps working.
 */
const USABLE = ["active", "trialing", "past_due"];

export function useEntitlements() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["entitlements", identity?.tenantId],
    queryFn: () => api.myEntitlements(getToken),
    staleTime: 5 * 60_000,
    enabled: !!identity,
  });
}

/** Whether this tenant may use one specific service. */
export function useModuleAccess(moduleId: ModuleId) {
  const { data, isLoading } = useEntitlements();
  const ent = data?.modules?.[moduleId];
  return {
    hasAccess: !!ent && USABLE.includes(ent.status),
    status: ent?.status ?? null,
    limits: ent?.limits ?? null,
    isLoading,
  };
}

/**
 * Access for every module at once.
 *
 * The sidebar has to ask about all of them, and hooks cannot be called in a
 * loop, so this reads the one entitlements response and reduces it to a set.
 */
export function useActiveModules() {
  const { data, isLoading } = useEntitlements();
  const active = new Set<ModuleId>();
  for (const [id, ent] of Object.entries(data?.modules ?? {})) {
    if (USABLE.includes(ent.status)) active.add(id as ModuleId);
  }
  return { active, isLoading };
}

export function useContracts() {
  const { getToken, identity } = useAuth();
  // Services are sold separately, so a tenant without this one should not be
  // issuing requests to it at all.
  const { hasAccess } = useModuleAccess("contract_compliance");
  return useQuery({
    queryKey: ["contracts", identity?.tenantId],
    queryFn: () => api.listContracts(getToken),
    staleTime: 30_000,
    enabled: !!identity && hasAccess,
  });
}

export function useObligations(contractId: string | null) {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["obligations", identity?.tenantId, contractId],
    queryFn: () => api.listObligations(contractId!, getToken),
    enabled: !!identity && !!contractId,
    staleTime: 30_000,
  });
}

export function useCreateContract() {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateContractInput) => api.createContract(input, getToken),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contracts", identity?.tenantId] }),
  });
}

export function useAnalyze(contractId: string) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.analyze(contractId, getToken),
    onSuccess: (obligations) => {
      // Seed the cache with the fresh result so the table updates instantly.
      qc.setQueryData(["obligations", identity?.tenantId, contractId], obligations);
      // Analysis also stamps the contract and writes an audit entry.
      qc.invalidateQueries({ queryKey: ["contracts", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["audit", identity?.tenantId] });
    },
  });
}

// --- documents --------------------------------------------------------------

export function useDocuments(contractId: string | null) {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["documents", identity?.tenantId, contractId],
    queryFn: () => api.listDocuments(contractId!, getToken),
    enabled: !!identity && !!contractId,
    staleTime: 30_000,
  });
}

export function useUploadDocument(contractId: string) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => api.uploadDocument(contractId, file, getToken),
    onSuccess: () => {
      // The upload replaces the contract body, so the contract itself is stale.
      qc.invalidateQueries({ queryKey: ["documents", identity?.tenantId, contractId] });
      qc.invalidateQueries({ queryKey: ["contract", identity?.tenantId, contractId] });
      qc.invalidateQueries({ queryKey: ["contracts", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["audit", identity?.tenantId] });
    },
  });
}

export function useDeleteDocument(contractId: string) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => api.deleteDocument(contractId, documentId, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", identity?.tenantId, contractId] });
      qc.invalidateQueries({ queryKey: ["audit", identity?.tenantId] });
    },
  });
}

/**
 * Download a document and hand the browser a save dialog.
 *
 * The blob URL is revoked immediately after the click so the bytes are not
 * retained in memory for the life of the tab.
 */
export function useDownloadDocument(contractId: string) {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: async ({ id, filename }: { id: string; filename: string }) => {
      const blob = await api.downloadDocument(contractId, id, getToken);
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  });
}

// --- contract lifecycle -----------------------------------------------------

export function useUpdateContract(contractId: string) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateContractInput) =>
      api.updateContract(contractId, input, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["audit", identity?.tenantId] });
    },
  });
}

export function useDeleteContract() {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contractId: string) => api.deleteContract(contractId, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["audit", identity?.tenantId] });
    },
  });
}

// --- obligation workflow ----------------------------------------------------

export function useCreateObligation(contractId: string) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateObligationInput) =>
      api.createObligation(contractId, input, getToken),
    onSuccess: () => invalidateObligations(qc, identity?.tenantId, contractId),
  });
}

export function useUpdateObligation(contractId: string | null) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateObligationInput }) =>
      api.updateObligation(id, input, getToken),
    onSuccess: () => invalidateObligations(qc, identity?.tenantId, contractId),
  });
}

export function useDeleteObligation(contractId: string | null) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteObligation(id, getToken),
    onSuccess: () => invalidateObligations(qc, identity?.tenantId, contractId),
  });
}

/** A single obligation write invalidates the contract view, the tenant feed and the trail. */
function invalidateObligations(
  qc: ReturnType<typeof useQueryClient>,
  tenantId: string | undefined,
  contractId: string | null,
) {
  if (contractId) qc.invalidateQueries({ queryKey: ["obligations", tenantId, contractId] });
  qc.invalidateQueries({ queryKey: ["tenant-obligations", tenantId] });
  qc.invalidateQueries({ queryKey: ["audit", tenantId] });
}

export function useTenantObligations(status: ObligationStatus | null) {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["tenant-obligations", identity?.tenantId, status],
    queryFn: () => api.listTenantObligations(status, getToken),
    enabled: !!identity,
    staleTime: 30_000,
  });
}

// --- audit ------------------------------------------------------------------

export function useAuditTrail() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["audit", identity?.tenantId],
    queryFn: () => api.listAudit(getToken),
    enabled: !!identity,
    staleTime: 15_000,
  });
}

// --- billing ----------------------------------------------------------------

export function usePlans() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["plans", identity?.tenantId],
    queryFn: () => api.listPlans(getToken),
    enabled: !!identity,
    // The catalog changes rarely; refetching it on every settings visit is waste.
    staleTime: 10 * 60_000,
  });
}

export function useCreateCheckout() {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: (priceId: string) => api.createCheckout(priceId, getToken),
  });
}

export function useOpenPortal() {
  const { getToken } = useAuth();
  return useMutation({
    mutationFn: () => api.createPortal(getToken),
    onSuccess: ({ url }) => {
      // The portal is Stripe-hosted, so we hand the browser over to it.
      window.location.assign(url);
    },
  });
}

// --- grant intelligence -----------------------------------------------------

export function useOrgProfile() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["org-profile", identity?.tenantId],
    queryFn: () => api.getProfile(getToken),
    enabled: !!identity,
    staleTime: 60_000,
  });
}

export function useSaveProfile() {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrgProfileInput) => api.saveProfile(input, getToken),
    onSuccess: (profile) => {
      qc.setQueryData(["org-profile", identity?.tenantId], profile);
      // Saving a scoring field queues a rescore server-side, so what is on
      // screen is now one scan out of date.
      qc.invalidateQueries({ queryKey: ["matches", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["match-summary", identity?.tenantId] });
    },
  });
}

export function useEligibilityCodes() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["eligibility-codes"],
    queryFn: () => api.eligibilityCodes(getToken),
    enabled: !!identity,
    // A fixed reference table. Refetching it is pure waste.
    staleTime: Infinity,
  });
}

export function useMatches(params: { minScore?: number; savedOnly?: boolean } = {}) {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["matches", identity?.tenantId, params.minScore ?? 0, !!params.savedOnly],
    queryFn: () => api.listMatches(params, getToken),
    enabled: !!identity,
    // Matches only change when a scan runs, and a scan invalidates this key
    // itself, so polling for them would be pointless load.
    staleTime: 5 * 60_000,
  });
}

export function useMatchSummary() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["match-summary", identity?.tenantId],
    queryFn: () => api.matchSummary(getToken),
    enabled: !!identity,
    staleTime: 60_000,
  });
}

export function useSetMatchState() {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { opportunityId: string; saved?: boolean; dismissed?: boolean }) =>
      api.setMatchState(v.opportunityId, { saved: v.saved, dismissed: v.dismissed }, getToken),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matches", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["match-summary", identity?.tenantId] });
    },
  });
}

export function useRequestScan() {
  const { getToken } = useAuth();
  return useMutation({ mutationFn: () => api.requestScan(getToken) });
}

/**
 * Follow a scan to completion.
 *
 * Polls only while the job is live, then stops. A fixed interval that never
 * turned itself off would keep calling a pay-per-invoke backend forever on any
 * tab left open, which is the expensive version of this mistake.
 *
 * On completion the match queries are invalidated once, so the list refreshes
 * exactly when there is something new to show rather than on a timer.
 */
export function useScanProgress(jobId: string | null) {
  const { getToken, identity } = useAuth();
  const qc = useQueryClient();
  const settled = useRef(false);

  const query = useQuery({
    queryKey: ["scan", jobId],
    queryFn: () => api.scanStatus(jobId!, getToken),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "queued" || s === "running" ? 2000 : false;
    },
  });

  const status = query.data?.status;
  useEffect(() => {
    if (!jobId) {
      settled.current = false;
      return;
    }
    if (settled.current) return;
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      settled.current = true;
      qc.invalidateQueries({ queryKey: ["matches", identity?.tenantId] });
      qc.invalidateQueries({ queryKey: ["match-summary", identity?.tenantId] });
    }
  }, [status, jobId, qc, identity?.tenantId]);

  return query;
}

// --- team -------------------------------------------------------------------

/**
 * The caller's rank in the active workspace, from the server.
 *
 * Deliberately not read from `identity.role`, which was captured when the
 * tenant token was minted: if an owner demotes someone mid-session, the stale
 * copy would keep offering them admin screens. Those screens would fail
 * server-side, which is safe but confusing.
 */
export function useMyRole() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["my-role", identity?.tenantId],
    queryFn: () => api.myRole(getToken),
    enabled: !!identity,
    staleTime: 60_000,
  });
}

/** True when the caller may administer the workspace. Cosmetic only. */
export function useIsTenantAdmin() {
  const { data, isLoading } = useMyRole();
  return {
    isAdmin: data?.role === "owner" || data?.role === "admin",
    isOwner: data?.role === "owner",
    role: data?.role ?? null,
    isLoading,
  };
}

export function useMembers() {
  const { getToken, identity } = useAuth();
  const { isAdmin } = useIsTenantAdmin();
  return useQuery({
    queryKey: ["members", identity?.tenantId],
    queryFn: () => api.listMembers(getToken),
    // Members is admin-only server-side. Firing it for a plain member would
    // produce a 403 in the console for no reason.
    enabled: !!identity && isAdmin,
    staleTime: 30_000,
  });
}

export function useInvites() {
  const { getToken, identity } = useAuth();
  const { isAdmin } = useIsTenantAdmin();
  return useQuery({
    queryKey: ["invites", identity?.tenantId],
    queryFn: () => api.listInvites(getToken),
    enabled: !!identity && isAdmin,
    staleTime: 30_000,
  });
}

export function useSeats() {
  const { getToken, identity } = useAuth();
  const { isAdmin } = useIsTenantAdmin();
  return useQuery({
    queryKey: ["seats", identity?.tenantId],
    queryFn: () => api.seats(getToken),
    enabled: !!identity && isAdmin,
    staleTime: 30_000,
  });
}

/**
 * Everything a membership change can affect.
 *
 * Kept in one place because the failure mode is subtle: removing a member
 * frees a seat, changes the member list, and may retire a pending invite. Miss
 * one and the screen contradicts itself -- a seat counter saying "3 of 3" next
 * to a list of two people.
 */
function useTeamInvalidation() {
  const qc = useQueryClient();
  const { identity } = useAuth();
  return () => {
    const t = identity?.tenantId;
    qc.invalidateQueries({ queryKey: ["members", t] });
    qc.invalidateQueries({ queryKey: ["invites", t] });
    qc.invalidateQueries({ queryKey: ["seats", t] });
    qc.invalidateQueries({ queryKey: ["my-role", t] });
  };
}

export function useChangeRole() {
  const { getToken } = useAuth();
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      api.changeRole(userId, role, getToken),
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const { getToken } = useAuth();
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (userId: string) => api.removeMember(userId, getToken),
    onSuccess: invalidate,
  });
}

export function useTransferOwnership() {
  const { getToken } = useAuth();
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (userId: string) => api.transferOwnership(userId, getToken),
    onSuccess: invalidate,
  });
}

export function useInviteMember() {
  const { getToken } = useAuth();
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      api.invite(email, role, getToken),
    onSuccess: invalidate,
  });
}

export function useRevokeInvite() {
  const { getToken } = useAuth();
  const invalidate = useTeamInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.revokeInvite(id, getToken),
    onSuccess: invalidate,
  });
}

// --- usage ------------------------------------------------------------------

export function useUsage(days: number) {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["usage", identity?.tenantId, days],
    queryFn: () => api.usage(days, getToken),
    enabled: !!identity,
    staleTime: 60_000,
  });
}

export function useUsageBySeat(days: number) {
  const { getToken, identity } = useAuth();
  const { isAdmin } = useIsTenantAdmin();
  return useQuery({
    queryKey: ["usage-by-seat", identity?.tenantId, days],
    queryFn: () => api.usageBySeat(days, getToken),
    // Per-seat spend is admin-only: a member seeing the workspace total is
    // transparency, a member seeing a colleague's is surveillance.
    enabled: !!identity && isAdmin,
    staleTime: 60_000,
  });
}
