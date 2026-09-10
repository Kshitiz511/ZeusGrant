import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { AddOnStore } from "@/components/app/AddOnStore";
import { ModuleBilling } from "@/components/billing/ModuleBilling";

import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { TRIAL_DAYS } from "@/lib/plans";
import { moduleById, planFor } from "@/lib/modules";
import { parseModulePrice } from "@/hooks/useModules";
import { formatLimit } from "@/lib/entitlements";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  createPortalSession,
  getTrialEligibility,
  syncSubscriptions,
} from "@/utils/payments.functions";
import { cn } from "@/lib/utils";

type BillingSearch = { plan: string | undefined; annual: boolean; checkout: string | undefined };

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: (search: Record<string, unknown>): BillingSearch => ({
    plan: typeof search["plan"] === "string" ? search["plan"] : undefined,
    annual: search["annual"] === true || search["annual"] === "true",
    checkout: typeof search["checkout"] === "string" ? search["checkout"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Billing & Plans | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Manage your ZCS GrantMatch subscription, start a three-day free trial, change plans and update payment details.",
      },
      { property: "og:title", content: "Billing & Plans | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content:
          "Start a three-day free trial or manage your GrantMatch subscription and invoices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Billing,
});

function Billing() {
  const { user } = useAuth();
  const search = Route.useSearch();
  const {
    subscription,
    hasAccess,
    isPastDue,
    limits,
    usage,
    savedCount,
    loading,
    refetch,
    proposals: caps,
    draftsRemaining,
    addonDraftsRemaining,
    cycleStart,
    cycleEnd,
  } = useEntitlements(user?.id);

  const [portalLoading, setPortalLoading] = useState(false);
  const [trialAvailable, setTrialAvailable] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void getTrialEligibility({ data: undefined }).then((r) => setTrialAvailable(r.trialAvailable));
  }, [subscription?.id]);

  // After returning from checkout, pull state straight from the payment
  // provider so the page is correct even if the webhook is a few seconds late.
  useEffect(() => {
    if (search.checkout !== "success") return;
    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        await syncSubscriptions({ data: { environment: getStripeEnvironment() } });
        await refetch();
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.checkout]);

  const manualSync = async () => {
    setSyncing(true);
    try {
      const result = await syncSubscriptions({ data: { environment: getStripeEnvironment() } });
      if ("error" in result) throw new Error(result.error);
      await refetch();
      toast.success("Billing status refreshed.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh billing status");
    } finally {
      setSyncing(false);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    try {
      const result = await createPortalSession({
        data: { environment: getStripeEnvironment(), returnUrl: window.location.href },
      });
      if ("error" in result) throw new Error(result.error);
      window.open(result.url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open the billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const parsed = parseModulePrice(subscription?.price_id);
  const currentLabel = parsed
    ? `${moduleById(parsed.module).name} — ${
        planFor(parsed.module, parsed.planId)?.name ?? parsed.planId
      }`
    : (subscription?.price_id ?? "");

  return (
    <AppShell title="Billing" description="Manage your plan, trial and payment details.">
      <div className="mb-6 overflow-hidden rounded-lg">
        <PaymentTestModeBanner />
      </div>

      <div className="mb-10">
        <ModuleBilling userId={user?.id} />
      </div>

      {isPastDue && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <p className="font-semibold text-foreground">Your last payment failed.</p>
            <p className="mt-1 text-muted-foreground">
              We&apos;ll keep retrying, but please update your payment method to avoid losing
              access.
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={openPortal}>
              Update payment method
            </Button>
          </div>
        </div>
      )}

      {search.checkout === "success" && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm text-foreground">
          Payment complete. Confirming your subscription…
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-foreground">Usage &amp; billing</h2>
          <Button variant="ghost" size="sm" onClick={manualSync} disabled={syncing}>
            <RefreshCw className={cn("mr-2 size-4", syncing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <Loader2 className="mt-4 size-5 animate-spin text-primary" />
        ) : subscription && hasAccess ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-2xl font-extrabold text-foreground">
                {currentLabel || subscription.price_id}
              </p>
              <Badge variant="secondary">{subscription.status}</Badge>
              {subscription.cancel_at_period_end && (
                <Badge variant="outline">Cancels at period end</Badge>
              )}
            </div>

            {subscription.status === "trialing" && subscription.trial_end && (
              <p className="text-sm text-muted-foreground">
                Free trial ends {new Date(subscription.trial_end).toLocaleString()}. Your card is
                charged then unless you cancel.
              </p>
            )}
            {subscription.current_period_end && (
              <p className="text-sm text-muted-foreground">
                {subscription.cancel_at_period_end ? "Access until" : "Renews on"}{" "}
                {new Date(subscription.current_period_end).toLocaleDateString()}.
              </p>
            )}

            <dl className="mt-4 grid gap-3 rounded-xl border border-border bg-background p-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Saved opportunities
                </dt>
                <dd className="mt-1 text-sm font-bold text-foreground">
                  {savedCount} / {formatLimit(limits.saved_opportunities_max)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Matches this cycle
                </dt>
                <dd className="mt-1 text-sm font-bold text-foreground">
                  {usage.matches_used} / {formatLimit(limits.matches_per_month)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Proposal drafts
                </dt>
                <dd className="mt-1 text-sm font-bold text-foreground">
                  {usage.proposal_drafts_used} / {formatLimit(caps.draftsPerMonth)}
                  {usage.addon_drafts_purchased > 0 && (
                    <span className="ml-2 font-medium text-muted-foreground">
                      + {addonDraftsRemaining} add-on left
                    </span>
                  )}
                </dd>
              </div>
            </dl>

            <div className="mt-4 rounded-xl border border-border bg-background p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">Proposal drafting</h3>
                <p className="text-xs text-muted-foreground">
                  Cycle {new Date(`${cycleStart}T00:00:00Z`).toLocaleDateString()} –{" "}
                  {new Date(`${cycleEnd}T00:00:00Z`).toLocaleDateString()} · resets monthly, unused
                  drafts do not roll over
                </p>
              </div>
              <ul className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                <li>
                  Plan allowance:{" "}
                  <span className="font-semibold text-foreground">
                    {formatLimit(caps.draftsPerMonth)} drafts/month
                  </span>
                </li>
                <li>
                  Remaining this cycle:{" "}
                  <span className="font-semibold text-foreground">
                    {draftsRemaining === null ? "Unlimited" : draftsRemaining}
                  </span>
                </li>
                <li>DOCX / PDF export: {caps.canExport ? "Included" : "Not on this plan"}</li>
                <li>
                  Compliance review:{" "}
                  {caps.complianceLevel === "full_ai"
                    ? "Full + AI section review"
                    : caps.complianceLevel === "full"
                      ? "Full review"
                      : "Basic checklist"}
                </li>
                <li>Templates: {caps.canUseTemplates ? "Included" : "Not on this plan"}</li>
                <li>
                  White-labeled export: {caps.canWhiteLabel ? "Included" : "Not on this plan"}
                </li>
              </ul>
            </div>

            <div className="mt-4">
              <h3 className="text-sm font-bold text-foreground">Add-ons</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                One-time purchases. Extra drafts apply to the current billing cycle only.
              </p>
              <AddOnStore />
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <Button onClick={openPortal} disabled={portalLoading} variant="outline">
                {portalLoading ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 size-4" />
                )}
                Invoices & payment method
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {trialAvailable
              ? `No module is active yet. Add a module above to start your ${TRIAL_DAYS}-day free trial — you won't be charged until the trial ends.`
              : "No module is active. Add one above to get started."}
          </p>
        )}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Switching a module&apos;s plan updates that subscription immediately and prorates the
        difference — you are never charged twice.
      </p>
    </AppShell>
  );
}
