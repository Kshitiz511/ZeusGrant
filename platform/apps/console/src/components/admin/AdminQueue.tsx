import { useState } from "react";
import { Empty, Failed, Loading, Panel, Pill, when } from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import { useAdminJobs, useJobAction } from "@/lib/admin-hooks";

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "mute"> = {
  succeeded: "ok",
  running: "ok",
  queued: "mute",
  failed: "bad",
  cancelled: "mute",
};

export function AdminQueue() {
  const [status, setStatus] = useState("");
  const [stuck, setStuck] = useState(false);
  const q = useAdminJobs({ status: status || undefined, stuck });
  const act = useJobAction();

  return (
    <Panel
      title={q.data ? `${q.data.total} job${q.data.total === 1 ? "" : "s"}` : "Jobs"}
      action={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={stuck}
              onChange={(e) => setStuck(e.target.checked)}
              className="size-3.5"
            />
            Stuck only
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="succeeded">Succeeded</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      }
    >
      {q.isLoading ? (
        <Loading label="Loading jobs" />
      ) : q.isError ? (
        <Failed error={q.error} />
      ) : q.data!.jobs.length === 0 ? (
        <Empty>{stuck ? "Nothing is stuck. " : ""}No jobs match that filter.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2 font-semibold">Job</th>
                <th className="px-5 py-2 font-semibold">Status</th>
                <th className="px-5 py-2 font-semibold">Created</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {q.data!.jobs.map((j) => (
                <tr key={j.id} className="border-b border-border/50 last:border-0 align-top">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-foreground">{j.kind}</p>
                    <p className="text-xs text-muted-foreground">
                      {j.module_id ?? "—"} · {j.id.slice(0, 8)}
                    </p>
                    {j.last_error && (
                      <p className="mt-1 max-w-md truncate text-xs text-destructive" title={j.last_error}>
                        {j.last_error}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-2.5">
                    <Pill tone={STATUS_TONE[j.status] ?? "mute"}>{j.status}</Pill>
                    {typeof j.attempts === "number" && j.attempts > 1 && (
                      <p className="mt-1 text-xs text-muted-foreground">{j.attempts} attempts</p>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted-foreground">{when(j.created_at)}</td>
                  <td className="px-5 py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      {/* Retry is offered only where it means something. A
                          succeeded job re-run from here would duplicate work
                          the tenant has already been charged for. */}
                      {(j.status === "failed" || j.status === "cancelled") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ jobId: j.id, action: "retry" })}
                        >
                          Retry
                        </Button>
                      )}
                      {(j.status === "queued" || j.status === "running") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ jobId: j.id, action: "cancel" })}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {act.isError && (
        <p className="px-5 py-3 text-xs text-destructive">{(act.error as Error).message}</p>
      )}
    </Panel>
  );
}
