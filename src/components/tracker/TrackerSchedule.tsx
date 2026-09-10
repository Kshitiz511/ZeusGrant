import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDate, STAGE_LABEL, type GrantRecord, type GrantReportingItem } from "@/lib/tracker";
import { cn } from "@/lib/utils";

export type EventKind =
  | "deadline"
  | "submission"
  | "award"
  | "reporting"
  | "interview"
  | "watchlist";

export type CalendarEvent = {
  date: string;
  kind: EventKind;
  label: string;
  funder: string;
  recordId: string;
  stage: string;
};

const KIND_DOT: Record<EventKind, string> = {
  deadline: "bg-red-500",
  submission: "bg-blue-500",
  award: "bg-emerald-500",
  reporting: "bg-orange-500",
  interview: "bg-purple-500",
  watchlist: "bg-muted-foreground/50",
};

const KIND_PILL: Record<EventKind, string> = {
  deadline: "bg-red-500/15 text-red-700 dark:text-red-300",
  submission: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  award: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  reporting: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  interview: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  watchlist: "bg-muted text-muted-foreground",
};

const KIND_LABEL: Record<EventKind, string> = {
  deadline: "Application deadline",
  submission: "Submission date",
  award: "Award date",
  reporting: "Reporting due",
  interview: "Interview / site visit",
  watchlist: "Saved / watchlist",
};

const KIND_FILTERS: { id: "all" | EventKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "deadline", label: "Deadlines" },
  { id: "submission", label: "Submissions" },
  { id: "award", label: "Award dates" },
  { id: "reporting", label: "Reporting" },
  { id: "interview", label: "Other" },
];

const STATUS_FILTERS: { id: string; label: string; stages: string[] }[] = [
  { id: "all", label: "All", stages: [] },
  { id: "in_progress", label: "In progress", stages: ["drafting", "ready_to_submit", "researching"] },
  { id: "submitted", label: "Submitted", stages: ["submitted", "under_review", "info_requested"] },
  { id: "awarded", label: "Awarded", stages: ["awarded"] },
  { id: "watching", label: "Watching", stages: ["identified"] },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(date: string): number {
  return Math.round(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${today()}T00:00:00Z`).getTime()) /
      86_400_000,
  );
}

function icsEscape(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

function downloadIcs(events: CalendarEvent[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZCS GrantMatch Innovation//Grant Tracker//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const e of events) {
    const day = e.date.replace(/-/g, "");
    const end = new Date(`${e.date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.recordId}-${e.kind}-${day}@grantmatch`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${day}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
      `SUMMARY:${icsEscape(`${KIND_LABEL[e.kind]}: ${e.label}`)}`,
      `CATEGORIES:${KIND_LABEL[e.kind]}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "grant-tracker.ics";
  a.click();
  URL.revokeObjectURL(url);
}

function countdownClass(days: number): string {
  if (days <= 7) return "bg-red-500/15 text-red-700 dark:text-red-300";
  if (days <= 30) return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
}

function countdownLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  return `${days}d left`;
}

/** Split-screen calendar (left) and synced chronological event list (right). */
export function TrackerSchedule({
  records,
  reporting,
  extraEvents = [],
  canExport = false,
}: {
  records: GrantRecord[];
  reporting: GrantReportingItem[];
  extraEvents?: CalendarEvent[];
  canExport?: boolean;
}) {
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  const [view, setView] = useState<"month" | "week">("month");
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    utc.setUTCDate(utc.getUTCDate() - utc.getUTCDay());
    return utc;
  });
  const [kindFilter, setKindFilter] = useState<"all" | EventKind>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [focusDate, setFocusDate] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  const events = useMemo<CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const r of records) {
      const base = { funder: r.funder, recordId: r.id, stage: r.stage };
      if (r.deadline)
        out.push({ ...base, date: r.deadline, kind: "deadline", label: r.grant_name });
      if (r.submission_date)
        out.push({
          ...base,
          date: r.submission_date,
          kind: "submission",
          label: `${r.grant_name} submitted`,
        });
      const decision = r.decision_date_actual ?? r.decision_date_expected;
      if (decision)
        out.push({ ...base, date: decision, kind: "award", label: `${r.grant_name} decision` });
      if (r.stage === "identified" && !r.deadline)
        out.push({
          ...base,
          date: r.created_at.slice(0, 10),
          kind: "watchlist",
          label: `${r.grant_name} saved`,
        });
    }
    for (const item of reporting) {
      if (item.due_date && !item.submitted_date) {
        const rec = records.find((r) => r.id === item.grant_record_id);
        out.push({
          date: item.due_date,
          kind: "reporting",
          label: item.title,
          funder: rec?.funder ?? "",
          recordId: item.grant_record_id,
          stage: rec?.stage ?? "",
        });
      }
    }
    return [...out, ...extraEvents].sort((a, b) => a.date.localeCompare(b.date));
  }, [records, reporting, extraEvents]);

  const filtered = useMemo(() => {
    const status = STATUS_FILTERS.find((s) => s.id === statusFilter);
    return events.filter((e) => {
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (status && status.stages.length && !status.stages.includes(e.stage)) return false;
      return true;
    });
  }, [events, kindFilter, statusFilter]);

  const upcoming = useMemo(
    () => filtered.filter((e) => e.date >= today()),
    [filtered],
  );

  // Sync: when a day/period is chosen on the calendar, scroll the list to it.
  useEffect(() => {
    if (!focusDate || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-date="${focusDate}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusDate, upcoming]);

  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart);
    d.setUTCDate(weekStart.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });

  const shift = (dir: 1 | -1) => {
    if (view === "month") {
      const next = new Date(Date.UTC(year, month + dir, 1));
      setCursor(next);
      setFocusDate(next.toISOString().slice(0, 10));
    } else {
      const next = new Date(weekStart);
      next.setUTCDate(weekStart.getUTCDate() + dir * 7);
      setWeekStart(next);
      setCursor(new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), 1)));
      setFocusDate(next.toISOString().slice(0, 10));
    }
  };

  const jumpTo = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    setCursor(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const ws = new Date(d);
    ws.setUTCDate(d.getUTCDate() - d.getUTCDay());
    setWeekStart(ws);
    setFocusDate(date);
  };

  const dayCell = (date: string, dayNumber: number, tall: boolean) => {
    const dayEvents = filtered.filter((e) => e.date === date);
    const isToday = date === today();
    return (
      <Popover key={date}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={() => setFocusDate(date)}
            className={cn(
              "flex flex-col items-start rounded-md border border-border p-1 text-left transition-colors hover:border-primary/60",
              tall ? "min-h-32" : "min-h-24",
              isToday && "border-primary bg-primary/5",
              focusDate === date && "ring-2 ring-primary/40",
            )}
          >
            <span
              className={cn(
                "text-[11px] font-semibold",
                isToday ? "text-primary" : "text-muted-foreground",
              )}
            >
              {dayNumber}
            </span>
            <span className="mt-1 flex w-full flex-col gap-1">
              {dayEvents.slice(0, 3).map((e, i) => (
                <span
                  key={`${e.recordId}-${i}`}
                  title={`${e.label} · ${e.funder} · ${KIND_LABEL[e.kind]} · ${countdownLabel(daysBetween(e.date))}`}
                  className={cn(
                    "block truncate rounded px-1 py-0.5 text-[10px]",
                    KIND_PILL[e.kind],
                  )}
                >
                  {e.label}
                </span>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{dayEvents.length - 3} more
                </span>
              )}
            </span>
          </button>
        </PopoverTrigger>
        {dayEvents.length > 0 && (
          <PopoverContent align="start" className="w-80">
            <p className="text-sm font-bold text-foreground">{formatDate(date)}</p>
            <ul className="mt-3 space-y-3">
              {dayEvents.map((e, i) => (
                <li key={`${e.recordId}-pop-${i}`} className="text-sm">
                  <span className="flex items-center gap-2">
                    <span className={cn("size-2 shrink-0 rounded-full", KIND_DOT[e.kind])} />
                    <span className="truncate font-semibold text-foreground">{e.label}</span>
                  </span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {KIND_LABEL[e.kind]}
                    {e.funder ? ` · ${e.funder}` : ""}
                  </p>
                  <Link
                    to="/tracker/$id"
                    params={{ id: e.recordId }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Go to grant
                  </Link>
                </li>
              ))}
            </ul>
          </PopoverContent>
        )}
      </Popover>
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[65%_minmax(0,1fr)]">
      {/* Calendar */}
      <section className="min-w-0 rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => shift(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <h3 className="min-w-40 text-center text-sm font-bold text-foreground">
              {view === "month"
                ? cursor.toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })
                : `Week of ${formatDate(weekStart.toISOString().slice(0, 10))}`}
            </h3>
            <Button variant="ghost" size="icon" aria-label="Next" onClick={() => shift(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {canExport && (
              <Button variant="outline" size="sm" onClick={() => downloadIcs(events)}>
                <CalendarPlus className="mr-2 size-4" /> Export .ics
              </Button>
            )}
            <div className="inline-flex rounded-full border border-border p-1">
              {(["month", "week"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setView(m)}
                  aria-pressed={view === m}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold capitalize",
                    view === m ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className={cn("size-2.5 rounded-full", KIND_DOT[k])} />
              {KIND_LABEL[k]}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="pb-1 text-center font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
          {view === "month" ? (
            <>
              {Array.from({ length: firstWeekday }).map((_, i) => (
                <div key={`pad-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) =>
                dayCell(`${monthPrefix}-${String(i + 1).padStart(2, "0")}`, i + 1, false),
              )}
            </>
          ) : (
            weekDays.map((date) => dayCell(date, Number(date.slice(8)), true))
          )}
        </div>
      </section>

      {/* Synced list */}
      <section className="flex min-w-0 flex-col rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h3 className="text-sm font-bold text-foreground">Upcoming dates</h3>
          <div className="mt-3 flex flex-wrap gap-1">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setKindFilter(f.id)}
                aria-pressed={kindFilter === f.id}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  kindFilter === f.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={statusFilter === f.id}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  statusFilter === f.id
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div ref={listRef} className="max-h-[36rem] flex-1 overflow-y-auto p-2">
          <ul className="space-y-1">
            {upcoming.map((e, i) => {
              const days = daysBetween(e.date);
              return (
                <li key={`${e.recordId}-row-${i}`} data-date={e.date}>
                  <Link
                    to="/tracker/$id"
                    params={{ id: e.recordId }}
                    onClick={() => jumpTo(e.date)}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/60",
                      focusDate === e.date && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", KIND_DOT[e.kind])} />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block text-xs",
                          days <= 7 ? "font-bold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {formatDate(e.date)}
                      </span>
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {e.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {e.funder || "—"} · {KIND_LABEL[e.kind]}
                        {e.stage ? ` · ${STAGE_LABEL[e.stage] ?? e.stage}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        countdownClass(days),
                      )}
                    >
                      {countdownLabel(days)}
                    </span>
                  </Link>
                </li>
              );
            })}
            {!upcoming.length && (
              <li className="px-3 py-10 text-center text-sm text-muted-foreground">
                No upcoming dates match these filters.
              </li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
