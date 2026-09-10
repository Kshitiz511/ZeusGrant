import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type ClientWorkspace = Tables<"client_workspaces">;

/** Agency client workspaces: one funding profile per managed client. */
export function useClientWorkspaces(userId?: string) {
  const [workspaces, setWorkspaces] = useState<ClientWorkspace[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setWorkspaces([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("client_workspaces")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    setWorkspaces((data ?? []) as ClientWorkspace[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (values: Omit<TablesInsert<"client_workspaces">, "user_id">) => {
      if (!userId) throw new Error("Not signed in");
      const { error } = await supabase
        .from("client_workspaces")
        .insert({ ...values, user_id: userId });
      if (error) throw new Error(error.message);
      await load();
    },
    [userId, load],
  );

  const update = useCallback(
    async (id: string, values: Partial<ClientWorkspace>) => {
      const { error } = await supabase.from("client_workspaces").update(values).eq("id", id);
      if (error) throw new Error(error.message);
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      await supabase.from("client_workspaces").delete().eq("id", id);
      await load();
    },
    [load],
  );

  return { workspaces, loading, create, update, remove, refetch: load };
}
