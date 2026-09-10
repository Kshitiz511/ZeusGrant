import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useAllObligations } from "@/hooks/useCompliance";
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  daysUntil,
  formatDate,
  isClosed,
  riskOf,
  type ComplianceObligation,
} from "@/lib/compliance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-tasks")({
  head: () => ({
    meta: [
      { title: "My tasks | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Every compliance obligation assigned to you across all of your contracts, sorted by urgency.",
      },
      { property: "og:title", content: "My tasks | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "A single personal worklist across every contract you manage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyTasksPage,
});

const GROUPS = [
  { id: "overdue", label: "Overdue" },
  { id: "week", label: "Due this week" },
  { id: "month", label: "Due this month" },
  { id: "later", label: "Later" },
  { id: "done", label: "Completed" },
] as const;

function groupOf(o: ComplianceObligation): (typeof GROUPS)[number]["id"] {
  if (isClosed(o)) return "done";
  const d = daysUntil(o.due_date);
  if (d === null) return "later";
  if (d < 0) return "overdue";
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  return "later";
}

function MyTasksPage() {
  const { user } = useAuth();
  const { obligations, loading } = useAllObligations(user?.id);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return obligations.filter((o) => !q || o.title.toLowerCase().includes(q));
  }, [obligations, query]);

  if (loading) {
    return (
      <AppShell title="My tasks">
        <Loader2 className="size-5 animate-spin text-primary" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="My tasks"
      description="Everything you owe across every contract, grouped by urgency."
    >
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search my tasks"
        className="mb-6 max-w-sm"
      />

      <div className="space-y-8">
        {GROUPS.map((g) => {
          const items = filtered.filter((o) => groupOf(o) === g.id);
          if (!items.length) return null;
          return (
            <section key={g.id}>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                {g.label} <span className="text-foreground">({items.length})</span>
              </h2>
              <ul className="space-y-2">
                {items.map((o) => (
                  <li
                    key={o.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{o.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {CATEGORY_LABEL[o.category] ?? o.category} ·{" "}
                        {STATUS_LABEL[o.status] ?? o.status}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "text-xs text-muted-foreground",
                        riskOf(o) === "overdue" && "font-semibold text-destructive",
                      )}
                    >
                      {formatDate(o.due_date)}
                    </span>
                    {o.priority === "high" && <Badge variant="destructive">High</Badge>}
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/compliance/$id" params={{ id: o.contract_id }}>
                        Open contract
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        {!filtered.length && (
          <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No compliance tasks yet. Upload a contract to get started.
          </p>
        )}
      </div>
    </AppShell>
  );
}
