import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type TaskAssignee = Tables<"compliance_task_assignees">;
export type TaskComment = Tables<"compliance_comments">;
export type ActivityEntry = Tables<"compliance_activity_log">;
export type TeamMember = Tables<"compliance_team_members">;

export async function logActivity(entry: {
  contract_id: string;
  obligation_id?: string | null;
  user_id: string;
  action: string;
  detail?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}) {
  await supabase.from("compliance_activity_log").insert(entry);
}

/** Assignees, comments and activity for one obligation. */
export function useTaskDetail(obligationId: string | null, userId?: string) {
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!obligationId || !userId) {
      setAssignees([]);
      setComments([]);
      setActivity([]);
      return;
    }
    setLoading(true);
    const [a, c, l] = await Promise.all([
      supabase
        .from("compliance_task_assignees")
        .select("*")
        .eq("obligation_id", obligationId)
        .order("assigned_at"),
      supabase
        .from("compliance_comments")
        .select("*")
        .eq("obligation_id", obligationId)
        .order("created_at"),
      supabase
        .from("compliance_activity_log")
        .select("*")
        .eq("obligation_id", obligationId)
        .order("created_at", { ascending: false }),
    ]);
    setAssignees(a.data ?? []);
    setComments(c.data ?? []);
    setActivity(l.data ?? []);
    setLoading(false);
  }, [obligationId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addAssignee = useCallback(
    async (contractId: string, name: string, email: string) => {
      if (!obligationId || !userId) return;
      const { data } = await supabase
        .from("compliance_task_assignees")
        .insert({
          obligation_id: obligationId,
          contract_id: contractId,
          user_id: userId,
          member_name: name,
          member_email: email || null,
        })
        .select("*")
        .single();
      if (data) setAssignees((xs) => [...xs, data]);
      await logActivity({
        contract_id: contractId,
        obligation_id: obligationId,
        user_id: userId,
        action: "assignee_added",
        new_value: name,
      });
      void load();
    },
    [obligationId, userId, load],
  );

  const removeAssignee = useCallback(
    async (a: TaskAssignee) => {
      await supabase.from("compliance_task_assignees").delete().eq("id", a.id);
      setAssignees((xs) => xs.filter((x) => x.id !== a.id));
      if (userId) {
        await logActivity({
          contract_id: a.contract_id,
          obligation_id: a.obligation_id,
          user_id: userId,
          action: "assignee_removed",
          old_value: a.member_name,
        });
      }
    },
    [userId],
  );

  const addComment = useCallback(
    async (contractId: string, body: string, authorName: string, parentId?: string) => {
      if (!obligationId || !userId) return;
      const mentions = Array.from(body.matchAll(/@([\w.@-]+)/g)).map((m) => m[1] as string);
      const { data } = await supabase
        .from("compliance_comments")
        .insert({
          obligation_id: obligationId,
          contract_id: contractId,
          user_id: userId,
          author_name: authorName,
          body,
          mentions,
          parent_id: parentId ?? null,
        })
        .select("*")
        .single();
      if (data) setComments((xs) => [...xs, data]);
      await logActivity({
        contract_id: contractId,
        obligation_id: obligationId,
        user_id: userId,
        action: "comment_posted",
        new_value: body.slice(0, 120),
      });
      void load();
    },
    [obligationId, userId, load],
  );

  return { assignees, comments, activity, loading, refetch: load, addAssignee, removeAssignee, addComment };
}

/** Team members on a contract. */
export function useContractTeam(contractId: string, userId?: string) {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("compliance_team_members")
      .select("*")
      .eq("contract_id", contractId)
      .order("created_at");
    setTeam(data ?? []);
    setLoading(false);
  }, [contractId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = useCallback(
    async (name: string, email: string, role: string) => {
      if (!userId) return;
      const { data, error } = await supabase
        .from("compliance_team_members")
        .insert({
          contract_id: contractId,
          user_id: userId,
          member_name: name,
          member_email: email,
          member_role: role,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      if (data) setTeam((xs) => [...xs, data]);
      await logActivity({
        contract_id: contractId,
        user_id: userId,
        action: "team_member_invited",
        new_value: `${name} (${role})`,
      });
    },
    [contractId, userId],
  );

  const setRole = useCallback(async (id: string, role: string) => {
    const { data } = await supabase
      .from("compliance_team_members")
      .update({ member_role: role })
      .eq("id", id)
      .select("*")
      .single();
    if (data) setTeam((xs) => xs.map((x) => (x.id === id ? data : x)));
  }, []);

  const remove = useCallback(async (id: string) => {
    await supabase.from("compliance_team_members").delete().eq("id", id);
    setTeam((xs) => xs.filter((x) => x.id !== id));
  }, []);

  return { team, loading, invite, setRole, remove, refetch: load };
}

/** Every obligation assigned to the signed-in user's contracts, for "My Tasks". */
export function useContractActivity(contractId: string, userId?: string) {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      const { data } = await supabase
        .from("compliance_activity_log")
        .select("*")
        .eq("contract_id", contractId)
        .order("created_at", { ascending: false })
        .limit(100);
      setActivity(data ?? []);
    })();
  }, [contractId, userId]);

  return activity;
}
