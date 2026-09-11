import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { ObligationRow } from "@/components/ObligationRow";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteObligation, useTenantObligations, useUpdateObligation } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { ObligationStatus } from "@/lib/types";

// Every obligation across every contract, in one queue. This is the view a
// compliance owner lives in day to day.

const FILTERS: { value: ObligationStatus | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

export function TasksView() {
  const [filter, setFilter] = useState<ObligationStatus | null>("open");
  const { data, isLoading, error } = useTenantObligations(filter);

  // Writes from this view can touch any contract, so no single contract cache
  // is targeted — the hooks invalidate the tenant feed instead.
  const update = useUpdateObligation(null);
  const remove = useDeleteObligation(null);

  const rows = data ?? [];
  const busy = update.isPending || remove.isPending;
  const writeError = (update.error ?? remove.error) as Error | null;

  return (
    <>
      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <button
            key={label}
            onClick={() => setFilter(value)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
              filter === value
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {writeError && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {writeError.message}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-10 text-center text-sm text-destructive">
            {(error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardCheck className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-3 font-bold text-foreground">Nothing here</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {filter === "open"
                ? "No open obligations. Analyze a contract to extract them."
                : "No obligations match this filter."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <ObligationRow
                key={o.id}
                obligation={o}
                context={o.contract_title}
                busy={busy}
                onStatusChange={(status) => update.mutate({ id: o.id, input: { status } })}
                onDelete={() => remove.mutate(o.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
