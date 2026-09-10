import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { getAdminOverview, type AuditRow } from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "Audit Log | GrantMatch Admin" },
      {
        name: "description",
        content: "Platform-wide security activity trail across every organization.",
      },
      { property: "og:title", content: "Audit Log | GrantMatch Admin" },
      { property: "og:description", content: "Internal security activity trail for staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const load = useServerFn(getAdminOverview);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    void load()
      .then((d) => setRows(d.activity))
      .catch(() => setRows([]));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter((r) => r.action.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  return (
    <AdminShell title="Audit log" description="Most recent security activity across the platform.">
      <div className="space-y-4">
        <Input
          className="max-w-md"
          placeholder="Filter by action"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card text-sm">
          {filtered.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
              <span className="text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}
              </span>
              <span className="font-semibold text-foreground">{r.action}</span>
              <span className="text-muted-foreground">{r.resource_type ?? "app"}</span>
            </li>
          ))}
          {!filtered.length && (
            <li className="p-4 text-muted-foreground">No activity recorded yet.</li>
          )}
        </ul>
      </div>
    </AdminShell>
  );
}
