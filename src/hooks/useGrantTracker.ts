import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GrantRecord } from "@/lib/tracker";

export type NewGrantRecord = {
  grant_name: string;
  funder: string;
  funder_type?: string;
  focus_areas?: string[];
  requested_amount?: number | null;
  deadline?: string | null;
  match_score?: number | null;
  portal_url?: string | null;
  opportunity_id?: string | null;
  opportunity_slug?: string | null;
  proposal_id?: string | null;
  stage?: string;
};

export function useGrantTracker(userId?: string) {
  const [records, setRecords] = useState<GrantRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("grant_records")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setRecords((data as GrantRecord[]) ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const logActivity = useCallback(
    async (grantRecordId: string, action: string, detail?: string) => {
      if (!userId) return;
      await supabase.from("grant_activity_log").insert({
        grant_record_id: grantRecordId,
        user_id: userId,
        action,
        ...(detail ? { detail } : {}),
      });
      await supabase
        .from("grant_records")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", grantRecordId);
    },
    [userId],
  );

  const addRecord = useCallback(
    async (input: NewGrantRecord): Promise<GrantRecord | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("grant_records")
        .insert({ ...input, user_id: userId })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      const record = data as GrantRecord;
      await supabase.from("grant_stage_history").insert({
        grant_record_id: record.id,
        user_id: userId,
        to_stage: record.stage,
      });
      await logActivity(record.id, "created", `Added to tracker in ${record.stage}`);
      setRecords((rs) => [record, ...rs]);
      return record;
    },
    [userId, logActivity],
  );

  const updateRecord = useCallback(
    async (id: string, patch: Partial<GrantRecord>, activity?: string) => {
      const { data, error } = await supabase
        .from("grant_records")
        .update({ ...patch, last_activity_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      setRecords((rs) => rs.map((r) => (r.id === id ? (data as GrantRecord) : r)));
      if (activity) await logActivity(id, "updated", activity);
      return data as GrantRecord;
    },
    [logActivity],
  );

  const moveStage = useCallback(
    async (record: GrantRecord, toStage: string, patch: Partial<GrantRecord> = {}) => {
      if (!userId || record.stage === toStage) {
        if (Object.keys(patch).length) await updateRecord(record.id, patch);
        return;
      }
      const outcome =
        toStage === "awarded"
          ? "awarded"
          : toStage === "declined"
            ? "declined"
            : toStage === "withdrawn"
              ? "withdrawn"
              : "pending";
      await updateRecord(record.id, { ...patch, stage: toStage, outcome });
      await supabase.from("grant_stage_history").insert({
        grant_record_id: record.id,
        user_id: userId,
        from_stage: record.stage,
        to_stage: toStage,
      });
      await logActivity(record.id, "stage_change", `Moved to ${toStage.replace(/_/g, " ")}`);
    },
    [userId, updateRecord, logActivity],
  );

  const deleteRecord = useCallback(async (id: string) => {
    await supabase.from("grant_records").delete().eq("id", id);
    setRecords((rs) => rs.filter((r) => r.id !== id));
  }, []);

  return { records, loading, refetch: load, addRecord, updateRecord, moveStage, deleteRecord, logActivity };
}
