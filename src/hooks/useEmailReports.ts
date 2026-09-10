import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type EmailReportSettings = Tables<"email_report_settings">;
export type EmailReportLog = Tables<"email_report_log">;

const INTERVAL_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

export function useEmailReports(userId?: string) {
  const [settings, setSettings] = useState<EmailReportSettings | null>(null);
  const [log, setLog] = useState<EmailReportLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setSettings(null);
      setLog([]);
      setLoading(false);
      return;
    }
    const [s, l] = await Promise.all([
      supabase.from("email_report_settings").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("email_report_log")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(25),
    ]);
    setSettings((s.data as EmailReportSettings | null) ?? null);
    setLog((l.data ?? []) as EmailReportLog[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (values: Partial<EmailReportSettings>) => {
      if (!userId) throw new Error("Not signed in");
      const frequency = values.frequency ?? settings?.frequency ?? "weekly";
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + (INTERVAL_DAYS[frequency] ?? 7));
      const { error } = await supabase.from("email_report_settings").upsert(
        {
          user_id: userId,
          enabled: values.enabled ?? settings?.enabled ?? false,
          frequency,
          recipients: values.recipients ?? settings?.recipients ?? [],
          min_fit_score: values.min_fit_score ?? settings?.min_fit_score ?? 60,
          next_send_at: (values.enabled ?? settings?.enabled) ? next.toISOString() : null,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(error.message);
      await load();
    },
    [userId, settings, load],
  );

  return { settings, log, loading, save, refetch: load };
}
