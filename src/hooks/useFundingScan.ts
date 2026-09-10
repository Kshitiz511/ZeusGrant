import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import type { ScanFrequency } from "@/lib/entitlements";
import { nextScanAt, scanIsDue } from "@/lib/scans";

export type ScanRun = Tables<"funding_scan_runs">;

/** Funding scan cadence: monthly, weekly or daily depending on the plan. */
export function useFundingScan(userId: string | undefined, frequency: ScanFrequency) {
  const [runs, setRuns] = useState<ScanRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setRuns([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("funding_scan_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    setRuns((data ?? []) as ScanRun[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lastRun = runs[0] ?? null;
  const lastRunAt = lastRun?.created_at ?? null;

  const recordScan = useCallback(
    async (matchesFound: number, newMatches: number, scanType: "scheduled" | "manual") => {
      if (!userId) return;
      await supabase.from("funding_scan_runs").insert({
        user_id: userId,
        scan_type: scanType,
        frequency,
        matches_found: matchesFound,
        new_matches: newMatches,
      });
      await load();
    },
    [userId, frequency, load],
  );

  return {
    runs,
    loading,
    lastRun,
    lastRunAt,
    nextScanAt: nextScanAt(lastRunAt, frequency),
    isDue: scanIsDue(lastRunAt, frequency),
    recordScan,
    refetch: load,
  };
}
