import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { useAuth } from "./auth";
import type { CreateContractInput } from "./types";

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
    },
  });
}
