import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { MODULES, TRIAL_DAYS, money, priceSummary, type ModuleId, type Selection } from "@/lib/modules";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing & Modules | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Buy the Grant Intelligence Suite, Contract Compliance Manager and Audit Compliance Vault separately or bundled. Save 10% on two modules, 15% on three.",
      },
      { property: "og:title", content: "Pricing & Modules | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content:
          "Three independent modules from $39/month, each with a three-day free trial and bundle savings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Pricing,
});

const addOns = [
  "5 additional proposal drafts",
  "3 or 10 additional contract slots",
  "Additional client workspace",
  "Human proposal review",
  "Grant readiness consultation",
  "Budget review",
  "Capability statement development",
  "Full-service grant writing package",
];

function Pricing() {
  const [annual, setAnnual] = useState(false);
  const [selected, setSelected] = useState<Record<string, string | null>>({
    grant_intelligence: "growth",
    contract_compliance: null,
    audit_compliance: null,
  });

  const selections = useMemo<Selection[]>(
    () =>
      MODULES.filter((m) => selected[m.id]).map((m) => ({
        module: m.id,
        planId: selected[m.id] as string,
      })),
    [selected],
  );

  const summary = useMemo(() => priceSummary(selections, annual), [selections, annual]);

  const toggle = (id: ModuleId, planId: string) =>
    setSelected((s) => ({ ...s, [id]: s[id] === planId ? null : planId }));

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <main>
        <section className="bg-surface-gradient">
          <div className="mx-auto max-w-3xl px-5 py-20 text-center lg:px-8">
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Pricing</p>
            <h1 className="mt-3 text-4xl text-ink sm:text-5xl">Three modules. Buy only what you need.</h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Each module is purchased independently and comes with its own {TRIAL_DAYS}-day free
              trial. Take two and save 10%, take all three and save 15%.
            </p>

            <div className="mt-9 inline-flex items-center gap-1 rounded-full border border-border bg-card p-1">
              {[
                { label: "Monthly", value: false },
                { label: "Annual — save 17%", value: true },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setAnnual(o.value)}
                  aria-pressed={annual === o.value}
                  className={cn(
                    "rounded-full px-5 py-2 text-sm font-semibold transition-colors",
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
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
          <div className="grid gap-6 lg:grid-cols-3">
            {MODULES.map((m) => {
              const chosen = selected[m.id];
              const plan = m.plans.find((p) => p.id === (chosen ?? "growth")) ?? m.plans[1]!;
              const amount = annual ? plan.annual : plan.monthly;
              return (
                <div
                  key={m.id}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-card p-7 transition-shadow",
                    chosen ? "border-primary shadow-lift" : "border-border hover:shadow-soft",
                  )}
                >
                  {chosen && (
                    <Badge className="absolute -top-3 left-7 bg-accent text-accent-foreground">
                      Selected
                    </Badge>
                  )}
                  <h2 className="text-xl text-ink">{m.name}</h2>
                  <p className="mt-2 min-h-10 text-sm text-muted-foreground">{m.tagline}</p>

                  <div className="mt-6">
                    <Select
                      value={chosen ?? "growth"}
                      onValueChange={(v) => setSelected((s) => ({ ...s, [m.id]: v }))}
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

                  <p className="mt-5 text-4xl font-extrabold text-ink">
                    {amount === null ? (
                      "Custom"
                    ) : (
                      <>
                        {money(amount)}
                        <span className="text-base font-semibold text-muted-foreground">
                          /{annual ? "year" : "month"}
                        </span>
                      </>
                    )}
                  </p>

                  <Button
                    variant={chosen ? "hero" : "outline"}
                    size="lg"
                    className="mt-5 w-full"
                    onClick={() => toggle(m.id, plan.id)}
                  >
                    {chosen ? "Remove from plan" : "Add this module"}
                  </Button>

                  <div className="mt-7 border-t border-border pt-6">
                    <p className="text-xs font-bold tracking-[0.12em] text-primary uppercase">
                      {plan.name} includes
                    </p>
                    <ul className="mt-3 space-y-3">
                      {plan.highlights.map((h) => (
                        <li
                          key={h}
                          className="flex gap-2.5 text-sm leading-relaxed font-medium text-ink"
                        >
                          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>

                    <p className="mt-6 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
                      Every plan includes
                    </p>
                    <ul className="mt-3 space-y-3">
                      {m.features.map((f) => (
                        <li key={f} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-10 lg:px-8">
          <div className="rounded-2xl border border-border bg-card p-7">
            <h2 className="text-xl text-ink">Your selection</h2>
            {summary.lines.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Choose at least one module above to see your price.
              </p>
            ) : (
              <>
                <ul className="mt-4 space-y-2">
                  {summary.lines.map((l) => (
                    <li key={l.module.id} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        {l.module.name} — {l.plan.name}
                      </span>
                      <span className="font-semibold text-ink">
                        {l.plan.monthly === null ? "Custom" : money(l.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
                {summary.bundleRate > 0 && (
                  <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
                    <span className="text-muted-foreground">
                      Bundle discount ({Math.round(summary.bundleRate * 100)}% for{" "}
                      {summary.lines.length} modules)
                    </span>
                    <span className="font-semibold text-accent">−{money(summary.bundleDiscount)}</span>
                  </div>
                )}
                <div className="mt-3 flex items-end justify-between border-t border-border pt-3">
                  <span className="text-sm font-semibold text-ink">
                    Total per {summary.interval}
                  </span>
                  <span className="text-3xl font-extrabold text-ink">{money(summary.total)}</span>
                </div>
                {summary.hasCustom && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enterprise plans are quoted separately and are not included in this total.
                  </p>
                )}
                <Button size="lg" className="mt-6" asChild>
                  <Link to="/billing" search={{ plan: undefined, annual, checkout: undefined }}>
                    Start your {TRIAL_DAYS}-day free trials <ArrowRight className="ml-1" />
                  </Link>
                </Button>
              </>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-8 lg:px-8">
          <div className="rounded-2xl border border-border bg-muted/60 p-8">
            <h2 className="text-xl text-ink">Trial terms</h2>
            <p className="mt-3 max-w-4xl text-sm leading-relaxed text-muted-foreground">
              Each module trial runs for three days from the moment you enroll in that module. Unless
              you cancel that module before its trial ends, your payment method is charged the plan
              price plus applicable taxes and the subscription renews at the selected billing interval
              until canceled. Modules are cancelled independently — ending one does not affect the
              others.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-24 lg:px-8">
          <h2 className="text-2xl text-ink">Add-ons available on every module</h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {addOns.map((a) => (
              <div
                key={a}
                className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
              >
                {a}
              </div>
            ))}
          </div>
        </section>

        <section className="bg-brand-gradient">
          <div className="mx-auto max-w-4xl px-5 py-20 text-center lg:px-8">
            <h2 className="text-3xl text-primary-foreground sm:text-4xl">Not sure where to start?</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-primary-foreground/75">
              Most teams start with the Grant Intelligence Suite, then add Contract Compliance once
              they win, and the Audit Vault when the first report is due.
            </p>
            <Button variant="accent" size="xl" className="mt-8" asChild>
              <Link to="/">
                Back to overview <ArrowRight />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
