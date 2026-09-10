import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AuditAction } from "@/lib/security";

export type AuditEntry = {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Append an entry to the tamper-evident security trail. Never throws: a failed
 * log line must not break the action the user is performing.
 */
export async function logSecurityEvent(
  userId: string | undefined,
  action: AuditAction,
  options: {
    resourceType?: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (!userId) return;
  try {
    await supabase.from("security_audit_log").insert({
      user_id: userId,
      action,
      resource_type: options.resourceType ?? null,
      resource_id: options.resourceId ?? null,
      user_agent: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 400),
      metadata: (options.metadata ?? {}) as never,
    });
  } catch {
    /* logging must never surface to the user */
  }
}

/** Reads the signed-in user's own trail (RLS keeps it to their records only). */
export function useSecurityLog(userId?: string, limit = 200) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [apiCalls, setApiCalls] = useState<{ action: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setEntries([]);
      setApiCalls([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [log, rate] = await Promise.all([
      supabase
        .from("security_audit_log")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("api_rate_log")
        .select("action,created_at")
        .eq("user_id", userId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    setEntries((log.data as AuditEntry[]) ?? []);
    setApiCalls((rate.data as { action: string; created_at: string }[]) ?? []);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  return { entries, apiCalls, loading, refetch: load };
}

/** Server-enforced hourly usage check. Returns true when the call may proceed. */
export async function checkRateLimit(action: string, limitPerHour: number): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    _action: action,
    _limit_per_hour: limitPerHour,
  });
  if (error) return true; // fail open: never block real work on a logging problem
  return Boolean((data as { allowed?: boolean } | null)?.allowed);
}
