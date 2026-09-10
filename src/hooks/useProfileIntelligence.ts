import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Tables } from "@/integrations/supabase/types";

export type SourceDocument = Tables<"profile_source_documents">;
export type PersonProfile = Tables<"person_profiles">;
export type ContentBlock = Tables<"proposal_content_library">;
export type ImpactStat = Tables<"impact_statistics">;
export type DataPoint = Tables<"org_profile_data_points">;
export type ScrapeSession = Tables<"website_scrape_sessions">;
export type OrgProfile = Tables<"org_profiles">;

export function useProfileIntelligence() {
  const { user } = useAuth();
  const userId = user?.id;

  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState<OrgProfile | null>(null);
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [people, setPeople] = useState<PersonProfile[]>([]);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [stats, setStats] = useState<ImpactStat[]>([]);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [scrapes, setScrapes] = useState<ScrapeSession[]>([]);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    const [o, d, p, b, s, dp, ws] = await Promise.all([
      supabase.from("org_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase
        .from("profile_source_documents")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("person_profiles")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("proposal_content_library")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("impact_statistics")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("org_profile_data_points")
        .select("*")
        .eq("user_id", userId)
        .order("category", { ascending: true }),
      supabase
        .from("website_scrape_sessions")
        .select("*")
        .eq("user_id", userId)
        .order("scraped_at", { ascending: false }),
    ]);
    setOrg(o.data ?? null);
    setDocuments(d.data ?? []);
    setPeople(p.data ?? []);
    setBlocks(b.data ?? []);
    setStats(s.data ?? []);
    setDataPoints(dp.data ?? []);
    setScrapes(ws.data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    userId,
    loading,
    org,
    documents,
    people,
    blocks,
    stats,
    dataPoints,
    scrapes,
    refresh: load,
  };
}

/** Upload a profile source file into the private documents bucket. */
export async function uploadProfileFile(
  userId: string,
  file: File,
  folder: string,
): Promise<string> {
  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${userId}/profile/${folder}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("grant-documents").upload(path, file);
  if (error) throw new Error(error.message);
  return path;
}

export async function openProfileFile(path: string, download = false) {
  const { data, error } = await supabase.storage
    .from("grant-documents")
    .createSignedUrl(path, 60 * 10, download ? { download: true } : undefined);
  if (error || !data) throw new Error(error?.message ?? "Could not open that file.");
  window.open(data.signedUrl, "_blank", "noopener");
}
