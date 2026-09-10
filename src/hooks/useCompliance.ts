import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  BudgetCategory,
  ComplianceContract,
  ComplianceDocument,
  ComplianceInvoice,
  ComplianceObligation,
  RateCard,
} from "@/lib/compliance";

export function useContracts(userId?: string) {
  const [contracts, setContracts] = useState<ComplianceContract[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setContracts([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("compliance_contracts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setContracts((data as ComplianceContract[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeContract = useCallback(async (id: string) => {
    await supabase.from("compliance_contracts").delete().eq("id", id);
    setContracts((cs) => cs.filter((c) => c.id !== id));
  }, []);

  return { contracts, loading, refetch: load, removeContract };
}

export type ContractBundle = {
  contract: ComplianceContract | null;
  obligations: ComplianceObligation[];
  /** Includes rows the user removed during review (kept for the AI extraction record). */
  allObligations: ComplianceObligation[];
  budget: BudgetCategory[];
  rates: RateCard[];
  invoices: ComplianceInvoice[];
  documents: ComplianceDocument[];
};

export function useContract(contractId: string, userId?: string) {
  const [bundle, setBundle] = useState<ContractBundle>({
    contract: null,
    obligations: [],
    allObligations: [],
    budget: [],
    rates: [],
    invoices: [],
    documents: [],
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const [contract, obligations, budget, rates, invoices, documents] = await Promise.all([
      supabase.from("compliance_contracts").select("*").eq("id", contractId).maybeSingle(),
      supabase
        .from("compliance_obligations")
        .select("*")
        .eq("contract_id", contractId)
        .order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("compliance_budget_categories").select("*").eq("contract_id", contractId),
      supabase.from("compliance_rate_cards").select("*").eq("contract_id", contractId),
      supabase
        .from("compliance_invoices")
        .select("*")
        .eq("contract_id", contractId)
        .order("period_end", { ascending: true, nullsFirst: false }),
      supabase
        .from("compliance_documents")
        .select("*")
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false }),
    ]);
    const allRows = (obligations.data as ComplianceObligation[]) ?? [];
    setBundle({
      contract: (contract.data as ComplianceContract) ?? null,
      obligations: allRows.filter((o) => o.status !== "removed"),
      allObligations: allRows,
      budget: (budget.data as BudgetCategory[]) ?? [],
      rates: (rates.data as RateCard[]) ?? [],
      invoices: (invoices.data as ComplianceInvoice[]) ?? [],
      documents: (documents.data as ComplianceDocument[]) ?? [],
    });
    setLoading(false);
  }, [contractId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateObligation = useCallback(
    async (id: string, patch: Partial<ComplianceObligation>) => {
      const { data, error } = await supabase
        .from("compliance_obligations")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      setBundle((b) => ({
        ...b,
        obligations: b.obligations.map((o) => (o.id === id ? (data as ComplianceObligation) : o)),
        allObligations: b.allObligations.map((o) =>
          o.id === id ? (data as ComplianceObligation) : o,
        ),
      }));
    },
    [],
  );

  const updateContract = useCallback(
    async (patch: Partial<ComplianceContract>) => {
      const { data, error } = await supabase
        .from("compliance_contracts")
        .update(patch)
        .eq("id", contractId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      setBundle((b) => ({ ...b, contract: data as ComplianceContract }));
    },
    [contractId],
  );

  return { ...bundle, loading, refetch: load, updateObligation, updateContract };
}

/** Load every obligation across all of the user's contracts (dashboard/alerts). */
export function useAllObligations(userId?: string) {
  const [obligations, setObligations] = useState<ComplianceObligation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setObligations([]);
      setLoading(false);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("compliance_obligations")
        .select("*")
        .eq("user_id", userId)
        .neq("status", "removed");
      setObligations((data as ComplianceObligation[]) ?? []);
      setLoading(false);
    })();
  }, [userId]);

  return { obligations, loading };
}
