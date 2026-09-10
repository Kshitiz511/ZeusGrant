import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import { isSubscriptionActive, type SubscriptionRow } from "@/hooks/useSubscription";
import { MODULES, type ModuleId, type PlatformModule } from "@/lib/modules";

const PREFIX: Record<string, ModuleId> = {
  gi: "grant_intelligence",
  cc: "contract_compliance",
  ac: "audit_compliance",
};

/** Legacy single-product price ids all map to the Grant Intelligence Suite. */
const LEGACY = /^(starter|growth|professional|agency)_(monthly|annual)$/;

export type ModuleParse = { module: ModuleId; planId: string; annual: boolean };

export function parseModulePrice(priceId: string | null | undefined): ModuleParse | null {
  if (!priceId) return null;
  const m = /^(gi|cc|ac)_(starter|growth|professional|agency)_(monthly|annual)$/.exec(priceId);
  if (m) {
    return { module: PREFIX[m[1]!]!, planId: m[2]!, annual: m[3] === "annual" };
  }
  const legacy = LEGACY.exec(priceId);
  if (legacy) {
    return { module: "grant_intelligence", planId: legacy[1]!, annual: legacy[2] === "annual" };
  }
  return null;
}

export type ModuleState = {
  module: PlatformModule;
  active: boolean;
  planId: string | null;
  annual: boolean;
  status: string | null;
  trialing: boolean;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  subscription: SubscriptionRow | null;
};

export function useModules(userId?: string) {
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    let environment: "sandbox" | "live";
    try {
      environment = getStripeEnvironment();
    } catch {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("subscriptions")
      .select(
        "id,status,price_id,product_id,stripe_subscription_id,current_period_start,current_period_end,cancel_at_period_end,trial_end,created_at",
      )
      .eq("user_id", userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(50);
    setRows((data ?? []) as SubscriptionRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void load();
    if (!userId) return;
    const channel = supabase
      .channel(`module-subs-${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const states = useMemo<Record<ModuleId, ModuleState>>(() => {
    const base = Object.fromEntries(
      MODULES.map((m) => [
        m.id,
        {
          module: m,
          active: false,
          planId: null,
          annual: false,
          status: null,
          trialing: false,
          renewsAt: null,
          cancelAtPeriodEnd: false,
          subscription: null,
        } as ModuleState,
      ]),
    ) as Record<ModuleId, ModuleState>;

    for (const row of rows) {
      const parsed = parseModulePrice(row.price_id);
      if (!parsed) continue;
      const state = base[parsed.module];
      const usable = isSubscriptionActive(row);
      if (state.active && !usable) continue;
      if (state.active && usable && state.subscription) continue;
      base[parsed.module] = {
        module: state.module,
        active: usable,
        planId: parsed.planId,
        annual: parsed.annual,
        status: row.status,
        trialing: row.status === "trialing",
        renewsAt: row.current_period_end,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        subscription: row,
      };
    }
    return base;
  }, [rows]);

  const activeModules = useMemo(
    () => MODULES.filter((m) => states[m.id]?.active),
    [states],
  );

  /** True when the user has never had a subscription for this module (trial eligible). */
  const trialEligible = useCallback(
    (id: ModuleId) => !rows.some((r) => parseModulePrice(r.price_id)?.module === id),
    [rows],
  );

  return {
    loading,
    states,
    activeModules,
    hasModule: (id: ModuleId) => Boolean(states[id]?.active),
    trialEligible,
    refetch: load,
  };
}
