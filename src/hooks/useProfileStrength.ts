import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { computeStrength, type ProfileStrength } from "@/lib/profile-strength";
import type {
  ContentBlock,
  DataPoint,
  ImpactStat,
  OrgProfile,
  PersonProfile,
  ScrapeSession,
  SourceDocument,
} from "@/hooks/useProfileIntelligence";

export type PlatformCounts = {
  proposalsInProgress: number;
  activeContracts: number;
  pastPerformance: number;
};

/**
 * Lightweight profile strength used by the persistent indicator and by feature
 * gates. Cached by react-query so every page shares one fetch.
 */
export function useProfileStrength() {
  const { user } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: ["profile-strength", userId],
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async () => {
      const [org, dp, people, docs, blocks, stats, scrapes, proposals, contracts, grants] =
        await Promise.all([
          supabase.from("org_profiles").select("*").eq("user_id", userId!).maybeSingle(),
          supabase.from("org_profile_data_points").select("*").eq("user_id", userId!),
          supabase.from("person_profiles").select("*").eq("user_id", userId!),
          supabase.from("profile_source_documents").select("*").eq("user_id", userId!),
          supabase.from("proposal_content_library").select("*").eq("user_id", userId!),
          supabase.from("impact_statistics").select("*").eq("user_id", userId!),
          supabase.from("website_scrape_sessions").select("*").eq("user_id", userId!),
          supabase
            .from("proposals")
            .select("id", { count: "exact", head: true })
            .eq("archived", false),
          supabase
            .from("compliance_contracts")
            .select("id", { count: "exact", head: true })
            .eq("archived", false),
          supabase.from("grant_records").select("id", { count: "exact", head: true }),
        ]);

      const counts: PlatformCounts = {
        proposalsInProgress: proposals.count ?? 0,
        activeContracts: contracts.count ?? 0,
        pastPerformance: grants.count ?? 0,
      };

      const input = {
        org: (org.data ?? null) as OrgProfile | null,
        dataPoints: (dp.data ?? []) as DataPoint[],
        people: (people.data ?? []) as PersonProfile[],
        documents: (docs.data ?? []) as SourceDocument[],
        blocks: (blocks.data ?? []) as ContentBlock[],
        stats: (stats.data ?? []) as ImpactStat[],
        scrapes: (scrapes.data ?? []) as ScrapeSession[],
        pastPerformanceCount: counts.pastPerformance,
      };

      return { strength: computeStrength(input), counts, input };
    },
  });

  const strength: ProfileStrength | null = query.data?.strength ?? null;
  return {
    loading: query.isLoading,
    strength,
    counts: query.data?.counts ?? { proposalsInProgress: 0, activeContracts: 0, pastPerformance: 0 },
    input: query.data?.input ?? null,
    refresh: query.refetch,
    /** Feature gates driven by profile completeness. */
    canMatch: (strength?.score ?? 0) >= 40,
    canDraft: (strength?.score ?? 0) >= 60,
    canRecommendTeam: (strength?.score ?? 0) >= 75,
  };
}
