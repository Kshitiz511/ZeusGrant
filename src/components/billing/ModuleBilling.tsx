import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { useModules, type ModuleState } from "@/hooks/useModules";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  changeSubscriptionPlan,
  setCancelAtPeriodEnd,
  syncSubscriptions,
} from "@/utils/payments.functions";
import { MODULES, TRIAL_DAYS, money, type ModuleId } from "@/lib/modules";
import { cn } from "@/lib/utils";

/** Per-module subscription cards: each module is bought and cancelled on its own. */
export function ModuleBilling({ userId }: { userId: string | undefined }) {
  const { states, trialEligible, loading, refetch } = useModules(userId);
  const [annual, setAnnual] = useState(false);
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [checkout, setCheckout] = useState<{ priceId: string; trialDays?: number } | null>(null);
  const [busy, setBusy] = useState<ModuleId | null>(null);

  if (loading) return null;

  const planFor = (id: ModuleId) => plans[id] ?? "growth";

  async function toggleCancel(id: ModuleId, state: ModuleState, cancel: boolean) {
    const priceId = state.subscription?.price_id;
    if (!priceId) return;
    setBusy(id);
    try {
      const environment = getStripeEnvironment();
      const result = await setCancelAtPeriodEnd({ data: { cancel, environment, priceId } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await syncSubscriptions({ data: { environment } });
      await refetch();
      toast.success(cancel ? "Module set to end at period end." : "Module will keep renewing.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this module.");
    } finally {
      setBusy(null);
    }
  }

  async function switchPlan(id: ModuleId, priceId: string) {
    setBusy(id);
    try {
      const environment = getStripeEnvironment();
      const result = await changeSubscriptionPlan({ data: { priceId, environment } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await syncSubscriptions({ data: { environment } });
      await refetch();
      toast.success("Plan updated. Any difference is prorated on your next invoice.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change this plan.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Your modules</h2>
          <p className="text-sm text-muted-foreground">
            Each module is billed separately and starts with a {TRIAL_DAYS}-day free trial.
          </p>
        </div>
        <div className="inline-flex rounded-full border border-border bg-card p-1">
          {[
            { label: "Monthly", value: false },
            { label: "Annual — save 17%", value: true },
          ].map((o) => (
            <button
              key={o.label}
              onClick={() => setAnnual(o.value)}
              aria-pressed={annual === o.value}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                annual === o.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {MODULES.map((m) => {
          const state = states[m.id];
          const selectedPlanId = plans[m.id] ?? state?.planId ?? planFor(m.id);
          const plan = m.plans.find((p) => p.id === selectedPlanId) ?? m.plans[1]!;
          const priceId = annual ? plan.annualPriceId : plan.monthlyPriceId;
          const amount = annual ? plan.annual : plan.monthly;

          return (
            <div
              key={m.id}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-5",
                state?.active ? "border-primary" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-foreground">{m.name}</h3>
                {state?.active ? (
                  <Badge className="bg-accent text-accent-foreground">
                    {state.trialing ? "Trial" : "Active"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    <Lock className="mr-1 size-3" /> Inactive
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{m.tagline}</p>

              {state?.active ? (
                <div className="mt-4 space-y-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {m.plans.find((p) => p.id === state.planId)?.name ?? "Active"} plan
                    {state.annual ? " · annual" : " · monthly"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {state.cancelAtPeriodEnd ? "Ends" : "Renews"}{" "}
                    {state.renewsAt ? new Date(state.renewsAt).toLocaleDateString() : "—"}
                  </p>

                  <Select
                    value={selectedPlanId}
                    onValueChange={(v) => setPlans((p) => ({ ...p, [m.id]: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {m.plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                          {p.monthly === null
                            ? " — custom"
                            : ` — ${money(annual ? p.annual! : p.monthly)}/${annual ? "yr" : "mo"}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <ul className="space-y-1">
                    {plan.highlights.map((h) => (
                      <li key={h} className="text-xs text-muted-foreground">
                        • {h}
                      </li>
                    ))}
                  </ul>

                  {priceId && !(state.planId === plan.id && state.annual === annual) ? (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={busy === m.id}
                      onClick={() => void switchPlan(m.id, priceId)}
                    >
                      {busy === m.id
                        ? "Working…"
                        : `Switch to ${plan.name} ${annual ? "annual" : "monthly"}`}
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant={state.cancelAtPeriodEnd ? "default" : "outline"}
                    className="w-full"
                    disabled={busy === m.id}
                    onClick={() => void toggleCancel(m.id, state, !state.cancelAtPeriodEnd)}
                  >
                    {busy === m.id
                      ? "Working…"
                      : state.cancelAtPeriodEnd
                        ? "Keep this module"
                        : "Cancel this module"}
                  </Button>
                </div>
              ) : (
                <>
                  <ul className="mt-4 space-y-2">
                    {m.features.slice(0, 4).map((f) => (
                      <li key={f} className="flex gap-2 text-xs text-muted-foreground">
                        <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    <Select
                      value={selectedPlanId}
                      onValueChange={(v) => setPlans((p) => ({ ...p, [m.id]: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {m.plans.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.monthly === null
                              ? " — custom"
                              : ` — ${money(annual ? p.annual! : p.monthly)}/${annual ? "yr" : "mo"}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {plan.highlights.map((h) => (
                      <li key={h} className="text-sm text-muted-foreground">
                        • {h}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex-1" />
                  {priceId && amount !== null ? (
                    <Button
                      className="mt-2 w-full"
                      onClick={() =>
                        setCheckout({
                          priceId,
                          ...(trialEligible(m.id) ? { trialDays: TRIAL_DAYS } : {}),
                        })
                      }
                    >
                      {trialEligible(m.id) ? `Start ${TRIAL_DAYS}-day trial` : "Add module"} —{" "}
                      {money(amount)}/{annual ? "yr" : "mo"}
                    </Button>
                  ) : (
                    <Button className="mt-2 w-full" variant="outline" asChild>
                      <a href="mailto:hello@zeusconsulting.com?subject=GrantMatch%20Enterprise">
                        Contact sales
                      </a>
                    </Button>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {checkout && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setCheckout(null)}>
              Close
            </Button>
          </div>
          <StripeEmbeddedCheckout
            priceId={checkout.priceId}
            {...(checkout.trialDays ? { trialDays: checkout.trialDays } : {})}
          />
        </div>
      )}
    </section>
  );
}
