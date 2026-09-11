import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditTrail } from "@/lib/hooks";
import type { AuditEntry } from "@/lib/types";

// The tenant's append-only activity trail. Records what changed and who did
// it, never the content itself — the trail is evidence, not a data copy.

const LABELS: Record<string, string> = {
  "contract.created": "created a contract",
  "contract.updated": "updated a contract",
  "contract.deleted": "deleted a contract",
  "contract.analyzed": "ran AI analysis",
  "contract.analyze_queued": "queued AI analysis",
  "document.uploaded": "uploaded a document",
  "document.deleted": "removed a document",
  "obligation.created": "added an obligation",
  "obligation.updated": "updated an obligation",
  "obligation.deleted": "deleted an obligation",
};

export function ActivityView() {
  const { data, isLoading, error } = useAuditTrail();
  const rows = data ?? [];

  return (
    <div className="rounded-xl border border-border bg-card">
      {isLoading ? (
        <div className="space-y-2 p-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="p-10 text-center text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <div className="p-12 text-center">
          <History className="mx-auto size-8 text-muted-foreground" />
          <h3 className="mt-3 font-bold text-foreground">No activity yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything your team does here will be recorded.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 p-4">
              <History className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Someone {LABELS[entry.action] ?? entry.action}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatTimestamp(entry.created_at)}
                  {describe(entry) && ` · ${describe(entry)}`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A short, human summary of the structured detail payload. */
function describe(entry: AuditEntry): string | null {
  const detail = entry.detail ?? {};

  if (typeof detail.filename === "string") return detail.filename;
  if (typeof detail.title === "string") return detail.title;
  if (typeof detail.from_status === "string" && typeof detail.to_status === "string") {
    return `${detail.from_status} → ${detail.to_status}`;
  }
  if (typeof detail.obligations_created === "number") {
    return `${detail.obligations_created} obligation(s) extracted`;
  }
  if (Array.isArray(detail.fields)) return `changed ${detail.fields.join(", ")}`;
  return null;
}

function formatTimestamp(value?: string): string {
  if (!value) return "just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "just now" : date.toLocaleString();
}
