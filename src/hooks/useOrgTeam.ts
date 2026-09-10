import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type OrgTeamMember = Tables<"org_team_members">;

export const ORG_TEAM_ROLES = [
  { id: "admin", label: "Admin", hint: "Full access to every workspace area and billing." },
  { id: "manager", label: "Grant manager", hint: "Manages opportunities, proposals, tracker and compliance." },
  { id: "contributor", label: "Contributor", hint: "Works on assigned proposals and compliance tasks." },
  { id: "viewer", label: "Viewer", hint: "Read-only access to reports and dashboards." },
] as const;

/** Organization-wide team members, capped by the plan's seat allowance. */
export function useOrgTeam(userId?: string) {
  const [members, setMembers] = useState<OrgTeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("org_team_members")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    setMembers((data ?? []) as OrgTeamMember[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = useCallback(
    async (name: string, email: string, role: string) => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase.from("org_team_members").insert({
        user_id: userId,
        member_name: name,
        member_email: email.toLowerCase(),
        member_role: role,
        status: "invited",
      });
      if (error) throw new Error(error.message);
      await load();
    },
    [userId, load],
  );

  const setRole = useCallback(
    async (id: string, role: string) => {
      await supabase.from("org_team_members").update({ member_role: role }).eq("id", id);
      await load();
    },
    [load],
  );

  const setStatus = useCallback(
    async (id: string, status: string) => {
      await supabase.from("org_team_members").update({ status }).eq("id", id);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await supabase.from("org_team_members").delete().eq("id", id);
      await load();
    },
    [load],
  );

  return { members, loading, invite, setRole, setStatus, remove, refetch: load };
}
