import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAiJobs, type AiJobRow } from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/ai-jobs")({
  head: () => ({
    meta: [
      { title: "AI Job Monitor | GrantMatch Admin" },
      {
        name: "description",
        content: "Live view of AI job activity, cost and failures across every organization.",
      },
      { property: "og:title", content: "AI Job Monitor | GrantMatch Admin" },
      { property: "og:description", content: "Internal AI job monitoring for GrantMatch staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminAiJobsPage,
});

const JOB_TYPES = [
  "all",
  "website_scrape",
  "contract_extraction",
  "proposal_generate",
  "team_recommend",
  "match_rescore",
  "capability_match",
];

function AdminAiJobsPage() {
  const load = useServerFn(listAiJobs);
  const [rows, setRows] = useState<AiJobRow[]>([]);
  const [status, setStatus] = useState("all");
  const [jobType, setJobType] = useState("all");

  useEffect(() => {
    const run = () => void load({ data: { status, jobType } }).then(setRows);
    run();
    const timer = setInterval(run, 15000);
    return () => clearInterval(timer);
  }, [load, status, jobType]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const todays = rows.filter((r) => r.started_at.slice(0, 10) === today);
    const spend = todays.reduce((sum, r) => sum + Number(r.estimated_cost_usd ?? 0), 0);
    const running = rows.filter((r) => r.status === "running").length;
    const failed = rows.filter((r) => r.status !== "success" && r.status !== "running").length;
    return { spend, running, failed, total: todays.length };
  }, [rows]);

  return (
    <AdminShell
      title="AI job monitor"
      description="Every AI run across the platform, refreshed automatically."
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="Running now" value={String(stats.running)} />
          <Stat label="Jobs today" value={String(stats.total)} />
          <Stat label="Failures shown" value={String(stats.failed)} />
          <Stat label="Estimated spend today" value={`$${stats.spend.toFixed(3)}`} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["all", "running", "success", "error", "timeout", "rate_limited"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={jobType} onValueChange={setJobType}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {JOB_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="p-3 text-left">Time</th>
                <th className="p-3 text-left">Organization</th>
                <th className="p-3 text-left">Job type</th>
                <th className="p-3 text-left">Duration</th>
                <th className="p-3 text-left">Tokens in/out</th>
                <th className="p-3 text-left">Cost</th>
                <th className="p-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 text-muted-foreground">
                    {new Date(r.started_at).toLocaleString()}
                  </td>
                  <td className="p-3 text-foreground">{r.org_name ?? "—"}</td>
                  <td className="p-3 font-semibold text-foreground">{r.job_type}</td>
                  <td className="p-3 text-muted-foreground">
                    {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {r.input_tokens ?? 0}/{r.output_tokens ?? 0}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    ${Number(r.estimated_cost_usd ?? 0).toFixed(3)}
                  </td>
                  <td className="p-3">
                    <Badge variant={r.status === "success" ? "default" : "destructive"}>
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={7}>
                    No AI jobs recorded for these filters yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-foreground">{value}</p>
    </div>
  );
}
