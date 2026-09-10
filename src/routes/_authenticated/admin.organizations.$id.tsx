import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell, usePlatformRole } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Json } from "@/integrations/supabase/types";
import {
  getAdminAccount,
  inspectAccountTable,
  runSupportAction,
  INSPECTABLE_TABLES,
  type AdminAccountDetail,
  type SupportAction,
} from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/organizations/$id")({
  head: () => ({
    meta: [
      { title: "Organization detail | GrantMatch Admin" },
      {
        name: "description",
        content: "Troubleshooting view for a single organization: jobs, data, errors and billing.",
      },
      { property: "og:title", content: "Organization detail | GrantMatch Admin" },
      { property: "og:description", content: "Internal troubleshooting view for support staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminOrgDetailPage,
});

function AdminOrgDetailPage() {
  const { id } = Route.useParams();
  const { isAdmin } = usePlatformRole();
  const load = useServerFn(getAdminAccount);
  const inspect = useServerFn(inspectAccountTable);
  const act = useServerFn(runSupportAction);

  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [table, setTable] = useState<string>(INSPECTABLE_TABLES[0]);
  const [rows, setRows] = useState<Record<string, Json>[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const refresh = useCallback(() => {
    void load({ data: { userId: id } })
      .then(setDetail)
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not load account"));
  }, [load, id]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    void inspect({ data: { userId: id, table } })
      .then(setRows)
      .catch(() => setRows([]));
  }, [inspect, id, table]);

  const runAction = async (action: SupportAction) => {
    try {
      const res = await act({ data: { userId: id, action, reason } });
      toast.success(res.message);
      if (action === "export_account_data" && res.payload) {
        const blob = new Blob([JSON.stringify(res.payload, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `account-export-${id}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    }
  };

  return (
    <AdminShell
      title={detail?.account.org_name ?? "Organization"}
      description={detail?.account.email ?? "Loading account…"}
    >
      {!detail ? (
        <p className="text-sm text-muted-foreground">Loading account…</p>
      ) : (
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="jobs">AI job history</TabsTrigger>
            <TabsTrigger value="data">Data inspector</TabsTrigger>
            <TabsTrigger value="errors">Error log</TabsTrigger>
            {isAdmin && <TabsTrigger value="billing">Billing</TabsTrigger>}
            <TabsTrigger value="support">Support actions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6 space-y-6">
            <section className="grid gap-4 rounded-2xl border border-border bg-card p-6 sm:grid-cols-2 xl:grid-cols-4">
              <Field label="Organization" value={detail.account.org_name} />
              <Field label="Type" value={detail.account.org_type} />
              <Field label="EIN" value={detail.account.ein} />
              <Field label="UEI" value={detail.account.uei} />
              <Field label="Owner" value={detail.account.email} />
              <Field label="Seats" value={String(detail.account.seats)} />
              <Field
                label="Onboarding"
                value={detail.account.onboarding_complete ? "Complete" : "In progress"}
              />
              <Field
                label="Created"
                value={new Date(detail.account.created_at).toLocaleDateString()}
              />
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">Module subscriptions</h2>
              <ul className="mt-3 divide-y divide-border text-sm">
                {detail.modules.map((m, i) => (
                  <li key={i} className="flex flex-wrap gap-3 py-2">
                    <span className="font-semibold text-foreground">{String(m["module"])}</span>
                    <Badge variant="secondary" className="capitalize">
                      {String(m["plan"])}
                    </Badge>
                    <span className="text-muted-foreground">{String(m["status"])}</span>
                    <span className="text-muted-foreground">
                      renews {String(m["current_period_end"] ?? "—").slice(0, 10)}
                    </span>
                  </li>
                ))}
                {!detail.modules.length && (
                  <li className="py-2 text-muted-foreground">No module subscriptions.</li>
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">Team members</h2>
              <ul className="mt-3 divide-y divide-border text-sm">
                {detail.team.map((t, i) => (
                  <li key={i} className="flex flex-wrap gap-3 py-2">
                    <span className="font-semibold text-foreground">
                      {String(t["member_name"])}
                    </span>
                    <span className="text-muted-foreground">{String(t["member_email"])}</span>
                    <Badge variant="secondary">{String(t["member_role"])}</Badge>
                    <span className="text-muted-foreground">{String(t["status"])}</span>
                  </li>
                ))}
                {!detail.team.length && (
                  <li className="py-2 text-muted-foreground">No additional team members.</li>
                )}
              </ul>
            </section>

            <section className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-bold text-foreground">Recent activity</h2>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {detail.audit.map((a) => (
                  <li key={a.id}>
                    {new Date(a.created_at).toLocaleString()} · {a.action}
                  </li>
                ))}
                {!detail.audit.length && <li>No recorded activity.</li>}
              </ul>
            </section>
          </TabsContent>

          <TabsContent value="jobs" className="mt-6">
            <div className="overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="p-3 text-left">Time</th>
                    <th className="p-3 text-left">Job type</th>
                    <th className="p-3 text-left">Status</th>
                    <th className="p-3 text-left">Duration</th>
                    <th className="p-3 text-left">Tokens</th>
                    <th className="p-3 text-left">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="p-3 text-muted-foreground">
                        {new Date(j.started_at).toLocaleString()}
                      </td>
                      <td className="p-3 font-semibold text-foreground">{j.job_type}</td>
                      <td className="p-3">
                        <Badge variant={j.status === "success" ? "default" : "destructive"}>
                          {j.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {j.duration_ms ? `${(j.duration_ms / 1000).toFixed(1)}s` : "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {(j.input_tokens ?? 0) + (j.output_tokens ?? 0) || "—"}
                      </td>
                      <td className="p-3 text-muted-foreground">{j.error_message ?? "—"}</td>
                    </tr>
                  ))}
                  {!detail.jobs.length && (
                    <tr>
                      <td className="p-4 text-muted-foreground" colSpan={6}>
                        No AI jobs recorded for this account yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          <TabsContent value="data" className="mt-6 space-y-4">
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INSPECTABLE_TABLES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Read-only. Every record you open is written to the security activity trail.
            </p>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="rounded-xl border border-border bg-card">
                  <button
                    className="w-full p-3 text-left text-sm font-semibold text-foreground"
                    onClick={() => setExpanded(expanded === i ? null : i)}
                  >
                    {String(row["name"] ?? row["title"] ?? row["org_name"] ?? row["id"])}
                  </button>
                  {expanded === i && (
                    <pre className="max-h-96 overflow-auto border-t border-border p-3 text-xs text-muted-foreground">
                      {JSON.stringify(row, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
              {!rows.length && (
                <p className="text-sm text-muted-foreground">No records in this table.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="errors" className="mt-6">
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {detail.errors.map((e) => (
                <li key={e.id} className="p-3 text-sm">
                  <p className="font-semibold text-foreground">
                    {e.error_type} · {e.source_function ?? "app"}
                  </p>
                  <p className="text-muted-foreground">{e.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()} ·{" "}
                    {e.resolved ? "Resolved" : "Unresolved"}
                  </p>
                </li>
              ))}
              {!detail.errors.length && (
                <li className="p-4 text-sm text-muted-foreground">No errors for this account.</li>
              )}
            </ul>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="billing" className="mt-6 space-y-4">
              <section className="rounded-2xl border border-border bg-card p-6 text-sm">
                <h2 className="text-lg font-bold text-foreground">Billing</h2>
                <pre className="mt-3 max-h-96 overflow-auto text-xs text-muted-foreground">
                  {JSON.stringify(
                    { subscription: detail.subscription, modules: detail.modules },
                    null,
                    2,
                  )}
                </pre>
              </section>
            </TabsContent>
          )}

          <TabsContent value="support" className="mt-6 space-y-4">
            <Input
              placeholder="Reason / note (recorded in the activity trail)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="max-w-xl"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void runAction("clear_rate_limit")}>
                Clear rate limits
              </Button>
              <Button variant="outline" onClick={() => void runAction("export_account_data")}>
                Download data export
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void runAction(detail.account.flagged ? "unflag_account" : "flag_account")
                }
              >
                {detail.account.flagged ? "Remove flag" : "Flag account"}
              </Button>
              {isAdmin && (
                <>
                  <Button variant="outline" onClick={() => void runAction("reset_onboarding")}>
                    Reset onboarding
                  </Button>
                  <Button variant="outline" onClick={() => void runAction("send_password_reset")}>
                    Send password reset
                  </Button>
                </>
              )}
            </div>
            {detail.note && (
              <p className="text-xs text-muted-foreground">Staff note: {detail.note}</p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </AdminShell>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value ?? "—"}</p>
    </div>
  );
}
