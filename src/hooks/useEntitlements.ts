import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type SubscriptionRow } from "@/hooks/useSubscription";
import { useModules } from "@/hooks/useModules";
import {
  billingCycleEnd,
  billingCycleStart,
  limitsForPrice,
  type PlanLimits,
} from "@/lib/entitlements";
import { getStripeEnvironment } from "@/lib/stripe";
import { proposalCapabilities, type ProposalCapabilities } from "@/lib/proposals";

export type Usage = {
  matches_used: number;
  proposal_drafts_used: number;
  addon_drafts_purchased: number;
  addon_drafts_used: number;
};

const EMPTY_USAGE: Usage = {
  matches_used: 0,
  proposal_drafts_used: 0,
  addon_drafts_purchased: 0,
  addon_drafts_used: 0,
};

export type Entitlements = {
  loading: boolean;
  subscription: SubscriptionRow | null;
  /** Active paid subscription or running trial. */
  hasAccess: boolean;
  isTrialing: boolean;
  isPastDue: boolean;
  limits: PlanLimits;
  /** Tier id of the Contract Compliance module ("none" when not subscribed). */
  compliancePlanId: string;
  /** Tier id of the Audit Compliance module ("none" when not subscribed). */
  auditPlanId: string;
  usage: Usage;
  savedCount: number;
  matchesRemaining: number | null;
  canSaveMore: boolean;
  proposals: ProposalCapabilities;
  /** Remaining drafts from the plan allowance only (null = unlimited). */
  planDraftsRemaining: number | null;
  /** Remaining purchased add-on drafts for this cycle. */
  addonDraftsRemaining: number;
  /** Plan allowance + add-on drafts (null = unlimited). */
  draftsRemaining: number | null;
  canCreateProposal: boolean;
  cycleStart: string;
  cycleEnd: string;
  renewalDate: string | null;
  recordMatchesViewed: (count: number) => Promise<void>;
  /** Server-side atomic check + increment. Throws when the limit is reached. */
  consumeProposalDraft: () => Promise<void>;
  logProposalEvent: (
    event: string,
    metadata?: Record<string, unknown>,
    proposalId?: string,
  ) => Promise<void>;
  refetch: () => Promise<void>;
};

export function useEntitlements(userId?: string): Entitlements {
  const { states, loading: subLoading, refetch: refetchSub } = useModules(userId);
  const [usage, setUsage] = useState<Usage>(EMPTY_USAGE);
  const [savedCount, setSavedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const gi = states.grant_intelligence;
  const cc = states.contract_compliance;
  const ac = states.audit_compliance;
  // Whichever module is active drives the parts of the app it owns.
  const subscription =
    (gi.active ? gi.subscription : null) ??
    (cc.active ? cc.subscription : null) ??
    (ac.active ? ac.subscription : null) ??
    gi.subscription ??
    cc.subscription ??
    ac.subscription;

  const cycleStart = billingCycleStart(subscription?.current_period_start ?? null);
  const cycleEnd = billingCycleEnd(cycleStart);

  const load = useCallback(async () => {
    if (!userId) {
      setUsage(EMPTY_USAGE);
      setSavedCount(0);
      setLoading(false);
      return;
    }
    const [usageRes, savedRes] = await Promise.all([
      supabase
        .from("usage_counters")
        .select("matches_used,proposal_drafts_used,addon_drafts_purchased,addon_drafts_used")
        .eq("user_id", userId)
        .eq("period_start", cycleStart)
        .maybeSingle(),
      supabase
        .from("saved_opportunities")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);
    setUsage((usageRes.data as Usage | null) ?? EMPTY_USAGE);
    setSavedCount(savedRes.count ?? 0);
    setLoading(false);
  }, [userId, cycleStart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Grant Intelligence tier drives matching / proposals; Contract Compliance
  // tier drives the contract tracker. Each is empty when that module is off.
  const limits = limitsForPrice(gi.active ? gi.subscription?.price_id : null);
  const ccLimits = limitsForPrice(cc.active ? cc.subscription?.price_id : null);
  const compliancePlanId = ccLimits.plan_id;
  const auditPlanId = limitsForPrice(ac.active ? ac.subscription?.price_id : null).plan_id;
  const isTrialing = subscription?.status === "trialing";
  const isPastDue = subscription?.status === "past_due";
  const hasAccess = gi.active || cc.active || ac.active;

  const matchesRemaining =
    limits.matches_per_month === null
      ? null
      : Math.max(0, limits.matches_per_month - usage.matches_used);

  const canSaveMore =
    hasAccess &&
    (limits.saved_opportunities_max === null || savedCount < limits.saved_opportunities_max);

  const proposals = proposalCapabilities(
    limits.plan_id,
    limits.proposal_drafts_per_month,
    isTrialing,
  );

  const planDraftsRemaining =
    proposals.draftsPerMonth === null
      ? null
      : Math.max(0, proposals.draftsPerMonth - usage.proposal_drafts_used);

  const addonDraftsRemaining = Math.max(0, usage.addon_drafts_purchased - usage.addon_drafts_used);

  const draftsRemaining =
    planDraftsRemaining === null ? null : planDraftsRemaining + addonDraftsRemaining;

  const canCreateProposal = hasAccess && (draftsRemaining === null || draftsRemaining > 0);

  const recordMatchesViewed = useCallback(
    async (count: number) => {
      if (!userId || count <= 0) return;
      const { data: existing } = await supabase
        .from("usage_counters")
        .select("id,matches_used")
        .eq("user_id", userId)
        .eq("period_start", cycleStart)
        .maybeSingle();

      const next = Math.max(existing?.matches_used ?? 0, count);
      if (existing) {
        if (next === existing.matches_used) return;
        await supabase.from("usage_counters").update({ matches_used: next }).eq("id", existing.id);
      } else {
        await supabase.from("usage_counters").insert({
          user_id: userId,
          period_start: cycleStart,
          period_end: cycleEnd,
          matches_used: next,
        });
      }
      setUsage((u) => ({ ...u, matches_used: next }));
    },
    [userId, cycleStart, cycleEnd],
  );

  const logProposalEvent = useCallback(
    async (event: string, metadata: Record<string, unknown> = {}, proposalId?: string) => {
      if (!userId) return;
      await supabase.from("proposal_events").insert({
        user_id: userId,
        event,
        metadata: metadata as never,
        ...(proposalId ? { proposal_id: proposalId } : {}),
      });
    },
    [userId],
  );

  /**
   * Backend enforcement: the database decides whether a new draft may start,
   * consuming the plan allowance first and then any purchased add-on drafts.
   */
  const consumeProposalDraft = useCallback(async () => {
    const { data, error } = await supabase.rpc("consume_proposal_draft", {
      _env: getStripeEnvironment(),
    });
    if (error) throw new Error(error.message);
    const result = (data ?? {}) as { allowed?: boolean; reason?: string; source?: string };
    if (!result.allowed) {
      if (result.reason === "no_subscription") {
        throw new Error("An active subscription or free trial is required to draft proposals.");
      }
      throw new Error("DRAFT_LIMIT_REACHED");
    }
    setUsage((u) =>
      result.source === "addon"
        ? { ...u, addon_drafts_used: u.addon_drafts_used + 1 }
        : { ...u, proposal_drafts_used: u.proposal_drafts_used + 1 },
    );
  }, []);

  const refetch = useCallback(async () => {
    await Promise.all([refetchSub(), load()]);
  }, [refetchSub, load]);

  return {
    loading: loading || subLoading,
    subscription,
    hasAccess,
    isTrialing,
    isPastDue,
    limits,
    compliancePlanId,
    auditPlanId,
    usage,
    savedCount,
    matchesRemaining,
    canSaveMore,
    proposals,
    planDraftsRemaining,
    addonDraftsRemaining,
    draftsRemaining,
    canCreateProposal,
    cycleStart,
    cycleEnd,
    renewalDate: subscription?.current_period_end ?? null,
    recordMatchesViewed,
    consumeProposalDraft,
    logProposalEvent,
    refetch,
  };
}
