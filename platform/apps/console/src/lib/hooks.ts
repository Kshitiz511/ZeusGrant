import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import type {
  CreateContractInput,
  CreateObligationInput,
  ObligationStatus,
  UpdateContractInput,
  UpdateObligationInput,
} from "./types";

// React Query gives us the "browser-based caching" layer: responses are cached
// per query key, deduped across components, and served stale-while-revalidate.
// This cuts redundant calls to the (serverless, pay-per-invoke) backend — the
// cost-effective default. staleTime is generous for lists that rarely change.

const MODULE_ID = "contract_compliance";

export function useEntitlements() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["entitlements", identity?.tenantId],
    queryFn: () => api.myEntitlements(getToken),
    staleTime: 5 * 60_000,
    enabled: !!identity,
  });
}

export function useModuleAccess() {
  const { data, isLoading } = useEntitlements();
  const ent = data?.modules?.[MODULE_ID];
  return {
    hasAccess: !!ent && ["active", "trialing", "past_due"].includes(ent.status),
    status: ent?.status ?? null,
    limits: ent?.limits ?? null,
    isLoading,
  };
}

export function useContracts() {
  const { getToken, identity } = useAuth();
  return useQuery({
    queryKey: ["contracts", identity?.tenantId],
    queryFn: () => api.listContracts(getToken),
    staleTime: 30_000,
    enabled: !!identity,
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
