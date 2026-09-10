import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell, usePlatformRole } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listPlatformErrors,
  resolvePlatformErrors,
  type ErrorRow,
} from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/errors")({
  head: () => ({
    meta: [
      { title: "Error Log | GrantMatch Admin" },
      {
        name: "description",
        content: "Grouped platform errors with resolution tracking and CSV export.",
      },
      { property: "og:title", content: "Error Log | GrantMatch Admin" },
      { property: "og:description", content: "Internal error tracking for GrantMatch staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminErrorsPage,
});

function AdminErrorsPage() {
  const { isAdmin } = usePlatformRole();
  const load = useServerFn(listPlatformErrors);
  const resolve = useServerFn(resolvePlatformErrors);
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [filter, setFilter] = useState("open");

  const refresh = () => void load({ data: { resolved: filter } }).then(setRows);
  useEffect(refresh, [load, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, ErrorRow[]>();
    for (const r of rows) {
      const key = `${r.error_type} · ${r.source_function ?? "app"}`;
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const exportCsv = () => {
    const header = "created_at,error_type,source_function,organization,message,resolved\n";
    const body = rows
      .map((r) =>
        [
          r.created_at,
          r.error_type,
          r.source_function ?? "",
          r.org_name ?? "",
          `"${r.message.replace(/"/g, '""')}"`,
          r.resolved,
        ].join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "platform-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resolveGroup = async (items: ErrorRow[]) => {
    try {
      await resolve({ data: { ids: items.map((i) => i.id), note: "Resolved from admin panel" } });
      toast.success(`${items.length} error${items.length === 1 ? "" : "s"} marked resolved.`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not resolve errors");
    }
  };

  return (
    <AdminShell
      title="Error log"
      description="Application and AI failures, grouped by type and source."
      actions={
        <Button variant="outline" onClick={exportCsv}>
          Export CSV
        </Button>
      }
    >
      <div className="space-y-5">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Unresolved</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        <div className="space-y-4">
          {groups.map(([key, items]) => (
            <section key={key} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-foreground">{key}</p>
                  <p className="text-xs text-muted-foreground">
                    {items.length} occurrence{items.length === 1 ? "" : "s"} · latest{" "}
                    {new Date(items[0]!.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{items.length}</Badge>
                  {isAdmin && filter !== "resolved" && (
                    <Button size="sm" variant="outline" onClick={() => void resolveGroup(items)}>
                      Mark resolved
                    </Button>
                  )}
                </div>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {items.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    {new Date(i.created_at).toLocaleString()} · {i.org_name ?? "unknown org"} ·{" "}
                    {i.message}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!groups.length && (
            <p className="text-sm text-muted-foreground">No errors for this filter.</p>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
