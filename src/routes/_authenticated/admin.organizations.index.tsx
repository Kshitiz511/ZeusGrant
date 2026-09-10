import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Flag, Search } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listAdminAccounts, type AdminAccount } from "@/utils/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/organizations/")({
  head: () => ({
    meta: [
      { title: "Organizations | GrantMatch Admin" },
      {
        name: "description",
        content: "Browse and inspect every organization account on the GrantMatch platform.",
      },
      { property: "og:title", content: "Organizations | GrantMatch Admin" },
      { property: "og:description", content: "Internal organization directory for support staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminOrganizationsPage,
});

function AdminOrganizationsPage() {
  const load = useServerFn(listAdminAccounts);
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load({ data: {} })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.org_name, r.email, r.full_name, r.ein, r.uei]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <AdminShell
      title="Organizations"
      description="Every account on the platform, with modules, seats and open errors."
    >
      <div className="space-y-5">
        <div className="relative max-w-md">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by organization, email, EIN or UEI"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="p-3 text-left">Organization</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Modules</th>
                <th className="p-3 text-left">Plan</th>
                <th className="p-3 text-left">Seats</th>
                <th className="p-3 text-left">Last active</th>
                <th className="p-3 text-left">Errors</th>
                <th className="p-3 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr key={r.user_id} className="hover:bg-muted/30">
                  <td className="p-3">
                    <p className="flex items-center gap-2 font-semibold text-foreground">
                      {r.flagged && <Flag className="size-3.5 text-destructive" />}
                      {r.org_name ?? "Unnamed organization"}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.email}</p>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.org_type ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {r.modules.length ? (
                        r.modules.map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">
                            {m.replace(/_/g, " ")}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground capitalize">{r.plan ?? "—"}</td>
                  <td className="p-3 text-muted-foreground">{r.seats}</td>
                  <td className="p-3 text-muted-foreground">
                    {r.last_active ? new Date(r.last_active).toLocaleDateString() : "—"}
                  </td>
                  <td className="p-3">
                    {r.errors ? (
                      <Badge variant="destructive">{r.errors}</Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="p-3">
                    <Link
                      to="/admin/organizations/$id"
                      params={{ id: r.user_id }}
                      className="font-semibold text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td className="p-4 text-muted-foreground" colSpan={8}>
                    {loading ? "Loading organizations…" : "No organizations match this search."}
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
