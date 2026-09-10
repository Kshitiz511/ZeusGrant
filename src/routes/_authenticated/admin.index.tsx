import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { getAdminOverview, type AdminOverview } from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "System Dashboard | GrantMatch Admin" },
      {
        name: "description",
        content: "Internal system health, AI job volume and platform activity for GrantMatch staff.",
      },
      { property: "og:title", content: "System Dashboard | GrantMatch Admin" },
      { property: "og:description", content: "Internal platform monitoring for GrantMatch staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDashboardPage,
});

const statusTone: Record<string, string> = {
  healthy: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-destructive",
};

function AdminDashboardPage() {
  const load = useServerFn(getAdminOverview);
  const [data, setData] = useState<AdminOverview | null>(null);

  useEffect(() => {
    void load()
      .then(setData)
      .catch(() => setData(null));
  }, [load]);

  return (
    <AdminShell
      title="System dashboard"
      description="Platform-wide health, usage and activity."
    >
      {!data ? (
        <p className="text-sm text-muted-foreground">Loading platform metrics…</p>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Active organizations"
              value={data.activeAccounts}
              hint={`${data.newAccounts30d} new in 30 days`}
              to="/admin/organizations"
            />
            <Kpi label="Active users (30d)" value={data.activeUsers30d} hint="Signed-in activity" />
            <Kpi
              label="AI jobs today"
              value={data.jobsToday}
              hint={`${data.jobSuccessRate}% success`}
              to="/admin/ai-jobs"
            />
            <Kpi
              label="Errors (24h)"
              value={data.errors24h}
              hint="Unresolved and resolved"
              to="/admin/errors"
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">New organizations (12 weeks)</h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.signups}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="week" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">AI job volume (7 days)</h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.jobVolume}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="day" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" />
                    <Line type="monotone" dataKey="failed" stroke="hsl(var(--destructive))" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <section className="rounded-2xl border border-border bg-card p-6 xl:col-span-2">
              <h2 className="text-lg font-bold text-foreground">Service health</h2>
              <ul className="mt-4 divide-y divide-border">
                {data.health.map((h) => (
                  <li key={h.service} className="flex items-center justify-between py-3 text-sm">
                    <span className="font-semibold text-foreground">{h.service}</span>
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span
                        className={`size-2.5 rounded-full ${statusTone[h.status] ?? "bg-muted"}`}
                      />
                      <span className="capitalize">{h.status}</span>
                      {h.latencyMs !== null && <span>· {h.latencyMs}ms</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">Recent activity</h2>
              <ul className="mt-4 space-y-2 text-xs">
                {data.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="truncate text-muted-foreground">
                      {new Date(a.created_at).toLocaleTimeString()} · {a.action}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {a.resource_type ?? "app"}
                    </Badge>
                  </li>
                ))}
                {!data.activity.length && (
                  <li className="text-muted-foreground">No activity recorded yet.</li>
                )}
              </ul>
            </section>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: number;
  hint: string;
  to?: string;
}) {
  const body = (
    <div className="rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-3xl font-extrabold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}
