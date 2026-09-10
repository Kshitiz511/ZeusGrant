import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowRight, Check, Lock } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { MODULES, moduleBySlug, money, startingPrice, TRIAL_DAYS } from "@/lib/modules";

export const Route = createFileRoute("/_authenticated/modules/$slug")({
  head: () => ({
    meta: [
      { title: "Add a module | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Add the Grant Intelligence Suite, Contract Compliance Manager or Audit Compliance Vault to your workspace.",
      },
      { property: "og:title", content: "Add a module | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Each module is purchased independently and starts with a three-day free trial.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ModuleTeaser,
});

function ModuleTeaser() {
  const { slug } = useParams({ from: "/_authenticated/modules/$slug" });
  const module = moduleBySlug(slug);

  if (!module) {
    return (
      <AppShell title="Module not found">
        <Button variant="outline" asChild>
          <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>Back to billing</Link>
        </Button>
      </AppShell>
    );
  }

  const others = MODULES.filter((m) => m.id !== module.id);

  return (
    <AppShell title={module.name} description={module.tagline}>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Lock className="size-4" /> This module is not active on your account yet.
          </p>
          <ul className="mt-5 space-y-3">
            {module.features.map((f) => (
              <li key={f} className="flex gap-2.5 text-sm text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>
                Add this module — from {money(startingPrice(module))}/mo <ArrowRight className="ml-1" />
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground">
              Includes a {TRIAL_DAYS}-day free trial. Cancel any time before it ends.
            </p>
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-bold text-foreground">Bundle and save</h2>
          <p className="mt-2 text-xs text-muted-foreground">
            Two modules save 10%, all three save 15%. Annual billing saves a further 17%.
          </p>
          <ul className="mt-4 space-y-3">
            {others.map((m) => (
              <li key={m.id} className="rounded-lg border border-border p-3">
                <p className="text-sm font-semibold text-foreground">{m.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {m.tagline} From {money(startingPrice(m))}/mo
                </p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </AppShell>
  );
}
