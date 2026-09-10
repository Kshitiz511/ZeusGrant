import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgencyAccess, AuditPackage, EvidenceFile, RegulatoryCitation } from "@/lib/audit";

export function useAuditVault(contractId: string, userId?: string) {
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [packages, setPackages] = useState<AuditPackage[]>([]);
  const [citations, setCitations] = useState<RegulatoryCitation[]>([]);
  const [access, setAccess] = useState<AgencyAccess[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const [ev, pk, ct, ac] = await Promise.all([
      supabase
        .from("evidence_vault_files")
        .select("*")
        .eq("contract_id", contractId)
        .order("upload_timestamp", { ascending: false }),
      supabase
        .from("audit_packages")
        .select("*")
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false }),
      supabase
        .from("regulatory_citations")
        .select("*")
        .eq("contract_id", contractId)
        .order("citation", { ascending: true }),
      supabase
        .from("agency_portal_access")
        .select("*")
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false }),
    ]);
    setEvidence((ev.data as EvidenceFile[]) ?? []);
    setPackages((pk.data as AuditPackage[]) ?? []);
    setCitations((ct.data as RegulatoryCitation[]) ?? []);
    setAccess((ac.data as AgencyAccess[]) ?? []);
    setLoading(false);
  }, [contractId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { evidence, packages, citations, access, loading, refetch: load };
}

/** Evidence counts across every contract, for the Audit Vault overview page. */
export function useAllEvidence(userId?: string) {
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setEvidence([]);
      setLoading(false);
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("evidence_vault_files")
        .select("*")
        .eq("user_id", userId)
        .order("upload_timestamp", { ascending: false });
      setEvidence((data as EvidenceFile[]) ?? []);
      setLoading(false);
    })();
  }, [userId]);

  return { evidence, loading };
}
