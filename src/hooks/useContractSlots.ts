import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CONTRACT_ADD_ONS, contractSlotsFromPurchases } from "@/lib/addons";

/**
 * Permanent extra contract slots the user has bought as one-time add-ons.
 * Derived from paid add-on purchases so refunds (status != "paid") drop off.
 */
export function useContractSlots(userId?: string) {
  const [extraSlots, setExtraSlots] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setExtraSlots(0);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("proposal_addon_purchases")
      .select("addon_id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .in(
        "addon_id",
        CONTRACT_ADD_ONS.map((a) => a.id),
      );
    setExtraSlots(contractSlotsFromPurchases((data ?? []).map((r) => r.addon_id)));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { extraSlots, loading, refetch: load };
}
