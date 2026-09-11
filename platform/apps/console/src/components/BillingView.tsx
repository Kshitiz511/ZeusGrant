import { useEffect, useMemo, useRef, useState } from "react";
import { CreditCard, ExternalLink, Loader2, Lock } from "lucide-react";
import { loadStripe, type StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCreateCheckout, useEntitlements, useOpenPortal, usePlans } from "@/lib/hooks";
import { MODULES } from "@/lib/modules";
import type { PlanOption } from "@/lib/types";

// The publishable key is safe to ship to the browser (that is its purpose), but
// it is still environment-specific, so it comes from build config rather than
// being hardcoded.
const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

export function BillingView() {
  const { data: plans, isLoading, error } = usePlans();
  const { data: entitlements } = useEntitlements();
  const checkout = useCreateCheckout();
  const portal = useOpenPortal();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const grouped = useMemo(() => groupByModule(plans ?? []), [plans]);
  const activeModules = new Set(Object.keys(entitlements?.modules ?? {}));

  if (clientSecret) {
    return (
      <EmbeddedCheckout
        clientSecret={clientSecret}
        onCancel={() => {
          setClientSecret(null);
          checkout.reset();
        }}
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Each module is billed separately, so you only pay for what you use.
        </p>
        <Button
          variant="outline"
          onClick={() => portal.mutate()}
          disabled={portal.isPending}
        >
          {portal.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <ExternalLink className="mr-2 size-4" />
          )}
          Manage billing
        </Button>
      </div>

      {portal.error ? <Notice tone="error">{portal.error.message}</Notice> : null}
      {checkout.error ? <Notice tone="error">{checkout.error.message}</Notice> : null}
      {!PUBLISHABLE_KEY ? (
        <Notice tone="warning">
          Payments are not configured for this environment. Set
          <code className="mx-1 rounded bg-muted px-1">VITE_STRIPE_PUBLISHABLE_KEY</code>
          to enable checkout.
        </Notice>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading plans…</p>
      ) : error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : Object.keys(grouped).length === 0 ? (
        <Notice tone="warning">
          No plans are available for purchase yet. Stripe price ids need to be configured
          against the plan catalog before checkout can be offered.
        </Notice>
      ) : (
        Object.entries(grouped).map(([moduleId, modulePlans]) => (
          <section key={moduleId} className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-foreground">
                {moduleLabel(moduleId)}
              </h3>
              {activeModules.has(moduleId.replace(/-/g, "_")) ? (
                <Badge variant="secondary">Active</Badge>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modulePlans.map((plan) => (
                <PlanCard
                  key={plan.plan_id}
                  plan={plan}
                  disabled={!PUBLISHABLE_KEY || checkout.isPending}
                  pending={checkout.isPending}
                  onSelect={(priceId) =>
                    checkout.mutate(priceId, {
                      onSuccess: (session) => setClientSecret(session.client_secret),
                    })
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function PlanCard({
  plan,
  disabled,
  pending,
  onSelect,
}: {
  plan: PlanOption;
  disabled: boolean;
  pending: boolean;
  onSelect: (priceId: string) => void;
}) {
  const priceId = plan.stripe_price_id_monthly ?? plan.stripe_price_id_annual;
  const limits = Object.entries(plan.limits ?? {});
  // Prefer monthly; fall back to annual for plans sold only on that cadence.
  const isMonthly = plan.monthly_cents != null && plan.stripe_price_id_monthly != null;
  const cents = isMonthly ? plan.monthly_cents : plan.annual_cents;

  return (
    <Card className="flex flex-col p-5">
      <h4 className="text-sm font-bold text-foreground">{plan.name}</h4>
      <p className="mt-2 text-2xl font-bold text-foreground">
        {formatPrice(cents)}
        {cents != null ? (
          <span className="ml-1 text-sm font-normal text-muted-foreground">
            /{isMonthly ? "month" : "year"}
          </span>
        ) : null}
      </p>

      {limits.length > 0 ? (
        <ul className="mt-4 space-y-1 text-sm text-muted-foreground">
          {limits.map(([key, value]) => (
            <li key={key}>
              {humanizeLimit(key)}: <span className="text-foreground">{formatLimit(value)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        className="mt-5 w-full"
        disabled={disabled || !priceId}
        onClick={() => priceId && onSelect(priceId)}
      >
        {pending ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <CreditCard className="mr-2 size-4" />
        )}
        Choose {plan.name}
      </Button>
    </Card>
  );
}

/**
 * Stripe's embedded checkout, mounted into a container we own.
 *
 * The iframe keeps card data entirely inside Stripe's origin, so no PCI-scoped
 * data ever touches this app.
 */
function EmbeddedCheckout({
  clientSecret,
  onCancel,
}: {
  clientSecret: string;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!PUBLISHABLE_KEY) {
      setError("Payments are not configured for this environment.");
      return;
    }

    let checkout: StripeEmbeddedCheckout | null = null;
    // Guards against a late resolve after the component has unmounted, which
    // would otherwise mount an orphaned iframe.
    let cancelled = false;

    loadStripe(PUBLISHABLE_KEY)
      .then(async (stripe) => {
        if (!stripe || cancelled || !containerRef.current) return;
        const instance = await stripe.createEmbeddedCheckoutPage({ clientSecret });
        if (cancelled || !containerRef.current) {
          instance.destroy();
          return;
        }
        checkout = instance;
        instance.mount(containerRef.current);
      })
      .catch((err: Error) => setError(err.message));

    return () => {
      cancelled = true;
      checkout?.destroy();
    };
  }, [clientSecret]);

  return (
    <div className="space-y-4">
      <Button variant="ghost" onClick={onCancel}>
        ← Back to plans
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Card details are handled entirely by Stripe and never reach our servers.
      </div>
      <div ref={containerRef} className="min-h-[520px] rounded-xl border border-border" />
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error" | "warning";
  children: React.ReactNode;
}) {
  const styles =
    tone === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

function groupByModule(plans: PlanOption[]): Record<string, PlanOption[]> {
  return plans.reduce<Record<string, PlanOption[]>>((acc, plan) => {
    (acc[plan.module_id] ??= []).push(plan);
    return acc;
  }, {});
}

function moduleLabel(moduleId: string): string {
  const normalized = moduleId.replace(/-/g, "_");
  return MODULES.find((m) => m.id === normalized)?.name ?? moduleId;
}

function formatPrice(cents: number | null): string {
  if (cents == null) return "Contact us";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function humanizeLimit(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatLimit(value: number | string | null): string {
  // The catalog expresses "no ceiling" as a NULL limit_value; -1 is also
  // accepted because some seeds use it.
  if (value == null || value === -1 || value === "-1") return "Unlimited";
  return String(value);
}
