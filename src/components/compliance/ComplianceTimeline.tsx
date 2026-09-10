import { CATEGORY_LABEL, RISK_CLASS, formatDate, riskOf, type ComplianceObligation } from "@/lib/compliance";
import { cn } from "@/lib/utils";

export function ComplianceTimeline({
  obligations,
  enabled,
}: {
  obligations: ComplianceObligation[];
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        The timeline view is available on Growth and above.
      </p>
    );
  }

  const dated = obligations
    .filter((o) => o.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

  if (!dated.length) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        No obligations have due dates yet.
      </p>
    );
  }

  const times = dated.map((o) => new Date(`${o.due_date}T00:00:00Z`).getTime());
  const min = Math.min(...times, Date.now());
  const max = Math.max(...times, Date.now());
  const span = Math.max(1, max - min);
  const todayPct = ((Date.now() - min) / span) * 100;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="relative space-y-3">
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-primary/40"
          style={{ left: `calc(30% + ${(todayPct / 100) * 70}%)` }}
          aria-hidden
        />
        {dated.map((o, i) => {
          const pct = ((times[i]! - min) / span) * 100;
          return (
            <div key={o.id} className="flex items-center gap-3">
              <div className="w-[30%] min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{o.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {CATEGORY_LABEL[o.category] ?? o.category} · {formatDate(o.due_date)}
                </p>
              </div>
              <div className="relative h-6 flex-1 rounded bg-muted/50">
                <div
                  className={cn(
                    "absolute top-1 h-4 rounded px-2 text-[10px] leading-4 text-background",
                    RISK_CLASS[riskOf(o)],
                  )}
                  style={{
                    left: `${Math.max(0, Math.min(96, pct))}%`,
                    minWidth: "4%",
                  }}
                  title={`${o.title} — ${formatDate(o.due_date)}`}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        The vertical line marks today. Red bars are overdue, amber are due within 14 days.
      </p>
    </div>
  );
}
