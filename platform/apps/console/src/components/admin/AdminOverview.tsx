import { Empty, Failed, Loading, Pill, Stat, when } from "@/components/admin/primitives";
import {
  useAdminJobs,
  useAdminModels,
  useAdminPlans,
  useAdminTenants,
  useQueueHealth,
} from "@/lib/admin-hooks";

/**
 * The platform at a glance.
 *
 * Every figure is derived from a real endpoint. Where something is not yet
 * measurable -- MRR and AI spend need the Phase 7 rollups that do not exist
 * yet -- the card says so instead of showing a zero. A zero that means "no
 * data" and a zero that means "no revenue" look identical, and the legacy
 * dashboard shipped exactly that confusion.
 */
export function AdminOverview({ onJump }: { onJump: (s: "tenants" | "queue" | "models" | "plans") => void }) {
  const tenants = useAdminTenants({});
  const suspended = useAdminTenants({ status: "suspended" });
  const plans = useAdminPlans();
  const models = useAdminModels();
  const stuck = useAdminJobs({ stuck: true });
  const failed = useAdminJobs({ status: "failed" });
  const health = useQueueHealth();

  if (tenants.isError) return <Failed error={tenants.error} />;

  const unpriced = models.data?.unpriced_models?.length ?? 0;
  const unsellable = plans.data?.unsellable_active_plans?.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Tenants"
          value={tenants.isLoading ? "…" : tenants.data?.total ?? 0}
          hint="All workspaces"
          onClick={() => onJump("tenants")}
        />
        <Stat
          label="Suspended"
          value={suspended.isLoading ? "…" : suspended.data?.total ?? 0}
          tone={(suspended.data?.total ?? 0) > 0 ? "warn" : "default"}
          hint="Cannot sign in"
          onClick={() => onJump("tenants")}
        />
        <Stat
          label="Stuck jobs"
          value={stuck.isLoading ? "…" : stuck.data?.total ?? 0}
          tone={(stuck.data?.total ?? 0) > 0 ? "bad" : "default"}
          hint="Lease expired, no worker"
          onClick={() => onJump("queue")}
        />
        <Stat
          label="Failed jobs"
          value={failed.isLoading ? "…" : failed.data?.total ?? 0}
          tone={(failed.data?.total ?? 0) > 0 ? "warn" : "default"}
          hint="Exhausted retries"
          onClick={() => onJump("queue")}
        />
      </div>

      {(unpriced > 0 || unsellable > 0) && (
        <div className="space-y-2">
          {unpriced > 0 && (
            <button
              onClick={() => onJump("models")}
              className="flex w-full items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-left"
            >
              <Pill tone="bad">{unpriced}</Pill>
              <span className="text-sm text-foreground">
                {unpriced === 1 ? "A model is" : "Models are"} being called with no price. Their
                spend records as NULL and is invisible in every cost rollup.
              </span>
            </button>
          )}
          {unsellable > 0 && (
            <button
              onClick={() => onJump("plans")}
              className="flex w-full items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left"
            >
              <Pill tone="warn">{unsellable}</Pill>
              <span className="text-sm text-foreground">
                {unsellable === 1 ? "An active plan has" : "Active plans have"} no Stripe price, so
                the storefront silently hides {unsellable === 1 ? "it" : "them"}.
              </span>
            </button>
          )}
        </div>
      )}

      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-foreground">Queue health by module</h3>
        </header>
        {health.isLoading ? (
          <Loading label="Reading queue health" />
        ) : health.isError ? (
          <Failed error={health.error} />
        ) : (
          <HealthTable data={health.data} />
        )}
      </section>

      <section className="rounded-xl border border-dashed border-border px-5 py-4">
        <h3 className="text-sm font-semibold text-foreground">Revenue and AI spend</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Not shown yet. MRR and spend-by-model need the usage rollups from Phase 7; until those
          exist these cards would be displaying a zero that means &ldquo;not measured&rdquo; while
          looking exactly like a zero that means &ldquo;no revenue&rdquo;.
        </p>
      </section>
    </div>
  );
}

function HealthTable({ data }: { data: Record<string, unknown> | undefined }) {
  // The endpoint returns per-module rows; shape is read defensively because it
  // is assembled in SQL rather than declared by a response model.
  const rows = Array.isArray((data as { modules?: unknown })?.modules)
    ? ((data as { modules: Record<string, unknown>[] }).modules)
    : Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : [];

  if (rows.length === 0) return <Empty>No queued work right now.</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-5 py-2 font-semibold">Module</th>
            <th className="px-5 py-2 font-semibold">Status</th>
            <th className="px-5 py-2 text-right font-semibold">Count</th>
            <th className="px-5 py-2 font-semibold">Oldest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              <td className="px-5 py-2 font-medium text-foreground">
                {String(r.module_id ?? "—")}
              </td>
              <td className="px-5 py-2">
                <Pill tone={r.status === "failed" ? "bad" : r.status === "running" ? "ok" : "mute"}>
                  {String(r.status ?? "—")}
                </Pill>
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-foreground">
                {String(r.count ?? r.depth ?? "—")}
              </td>
              <td className="px-5 py-2 text-muted-foreground">
                {when(r.oldest_created_at as string | undefined)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
