import { Check, Circle, Clock, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, priorityVariant } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Obligation, ObligationStatus } from "@/lib/types";

// A single obligation with its workflow controls. Status is the compliance
// signal that matters, so it is a one-click change rather than a form.

const STATUSES: {
  value: ObligationStatus;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "open", label: "Open", icon: Circle },
  { value: "in_progress", label: "In progress", icon: Clock },
  { value: "done", label: "Done", icon: Check },
];

export function ObligationRow({
  obligation,
  onStatusChange,
  onDelete,
  busy,
  context,
}: {
  obligation: Obligation;
  onStatusChange: (status: ObligationStatus) => void;
  onDelete?: () => void;
  busy?: boolean;
  context?: string;
}) {
  const isDone = obligation.status === "done";
  const overdue = isOverdue(obligation);

  return (
    <li className="flex flex-wrap items-start gap-3 p-4">
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "font-semibold text-foreground",
            isDone && "text-muted-foreground line-through",
          )}
        >
          {obligation.description}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {context ? `${context} · ` : ""}
          {obligation.responsible ? `${obligation.responsible} · ` : ""}
          <span className={cn(overdue && "font-semibold text-destructive")}>
            Due {formatDate(obligation.due_date)}
            {overdue && " · overdue"}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        {obligation.source === "ai" && <Badge variant="secondary">AI</Badge>}
        <Badge variant={priorityVariant(obligation.priority)} className="capitalize">
          {obligation.priority}
        </Badge>

        <div
          role="group"
          aria-label="Obligation status"
          className="flex overflow-hidden rounded-md border border-border"
        >
          {STATUSES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={obligation.status === value}
              disabled={busy}
              onClick={() => onStatusChange(value)}
              className={cn(
                "px-2 py-1.5 transition-colors disabled:opacity-50",
                obligation.status === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>

        {onDelete && (
          <button
            type="button"
            title="Delete obligation"
            aria-label="Delete obligation"
            disabled={busy}
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

/** Past due and not yet closed out. Compared date-only to avoid timezone noise. */
function isOverdue(obligation: Obligation): boolean {
  if (!obligation.due_date || obligation.status === "done") return false;
  const today = new Date().toISOString().slice(0, 10);
  return obligation.due_date < today;
}
