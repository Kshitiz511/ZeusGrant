import { Empty, Failed, Loading, money, Panel, Pill } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { useAdminPlans, useUpdatePlan } from "@/lib/admin-hooks";

export function AdminPlans() {
  const q = useAdminPlans();
  const update = useUpdatePlan();

  if (q.isLoading) return <Panel title="Plans"><Loading label="Loading catalogue" /></Panel>;
  if (q.isError) return <Panel title="Plans"><Failed error={q.error} /></Panel>;

  const { plans, unsellable_active_plans: unsellable } = q.data!;
  if (plans.length === 0) return <Panel title="Plans"><Empty>No plans defined.</Empty></Panel>;

  const byModule = plans.reduce<Record<string, typeof plans>>((acc, p) => {
    (acc[p.module_id] ||= []).push(p);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      {unsellable.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-foreground">
          <strong className="font-semibold">{unsellable.join(", ")}</strong>{" "}
          {unsellable.length === 1 ? "is active but has" : "are active but have"} no Stripe price.
          The storefront drops such plans silently, which looks from outside like a broken pricing
          page rather than a missing price.
        </div>
      )}

      {Object.entries(byModule).map(([moduleId, modulePlans]) => (
        <Panel key={moduleId} title={moduleId}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-semibold">Plan</th>
                  <th className="px-5 py-2 text-right font-semibold">Monthly</th>
                  <th className="px-5 py-2 text-right font-semibold">Annual</th>
                  <th className="px-5 py-2 font-semibold">Stripe</th>
                  <th className="px-5 py-2 font-semibold">State</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody>
                {modulePlans.map((p) => (
                  <tr key={p.plan_id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-foreground">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.plan_id}</p>
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                      {money(p.monthly_cents)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums text-foreground">
                      {money(p.annual_cents)}
                    </td>
                    <td className="px-5 py-2.5">
                      {p.stripe_price_id_monthly || p.stripe_price_id_annual ? (
                        <Pill tone="ok">linked</Pill>
                      ) : (
                        <Pill tone="warn">no price</Pill>
                      )}
                    </td>
                    <td className="px-5 py-2.5">
                      <Pill tone={p.is_active ? "ok" : "mute"}>
                        {p.is_active ? "active" : "hidden"}
                      </Pill>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      {/* Deactivating hides a plan from the storefront; it does
                          not cancel anyone already on it, which is why the
                          label says hide rather than delete. */}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({ planId: p.plan_id, patch: { is_active: !p.is_active } })
                        }
                      >
                        {p.is_active ? "Hide" : "Publish"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}

      {update.isError && (
        <p className="text-sm text-destructive">{(update.error as Error).message}</p>
      )}
    </div>
  );
}
