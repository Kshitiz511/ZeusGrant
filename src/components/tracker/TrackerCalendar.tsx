import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate, type GrantRecord, type GrantReportingItem } from "@/lib/tracker";
import { cn } from "@/lib/utils";


type EventKind = "deadline" | "reporting" | "decision" | "compliance" | "reminder";

type CalendarEvent = {
  date: string;
  kind: EventKind;
  label: string;
  recordId: string;
};

const KIND_CLASS: Record<EventKind, string> = {
  deadline: "bg-destructive/15 text-destructive",
  reporting: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  decision: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  compliance: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  reminder: "bg-muted text-muted-foreground",
};

const KIND_LABEL: Record<EventKind, string> = {
  deadline: "Submission deadline",
  reporting: "Reporting deadline",
  decision: "Decision date",
  compliance: "Compliance milestone",
  reminder: "Follow-up reminder",
};

function icsEscape(text: string): string {
  return text.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
}

/** Standards-compliant .ics feed of every tracker date, for Outlook/Google/Apple. */
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

export function TrackerCalendar({
  records,
  reporting,
  compliance = [],
  canExport = false,
}: {
  records: GrantRecord[];
  reporting: GrantReportingItem[];
  compliance?: CalendarEvent[];
  canExport?: boolean;
}) {

  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  });
  const [mode, setMode] = useState<"month" | "agenda">("month");

  const events = useMemo<CalendarEvent[]>(() => {
    const out: CalendarEvent[] = [];
    for (const r of records) {
      if (r.deadline) out.push({ date: r.deadline, kind: "deadline", label: r.grant_name, recordId: r.id });
      const decision = r.decision_date_actual ?? r.decision_date_expected;
      if (decision)
        out.push({ date: decision, kind: "decision", label: `${r.grant_name} decision`, recordId: r.id });
    }
    for (const item of reporting) {
      if (item.due_date && !item.submitted_date)
        out.push({
          date: item.due_date,
          kind: "reporting",
          label: item.title,
          recordId: item.grant_record_id,
        });
    }
    return [...out, ...compliance].sort((a, b) => a.date.localeCompare(b.date));
  }, [records, reporting, compliance]);

  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

  const upcoming = events.filter((e) => e.date >= new Date().toISOString().slice(0, 10)).slice(0, 25);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            onClick={() => setCursor(new Date(Date.UTC(year, month - 1, 1)))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h3 className="min-w-40 text-center text-sm font-bold text-foreground">
            {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next month"
            onClick={() => setCursor(new Date(Date.UTC(year, month + 1, 1)))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="inline-flex rounded-full border border-border p-1">
          {(["month", "agenda"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold capitalize",
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        {canExport && (
          <Button variant="outline" size="sm" onClick={() => downloadIcs(events)}>
            <CalendarPlus className="mr-2 size-4" /> Export calendar (.ics)
          </Button>
        )}

      </div>

      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", KIND_CLASS[k].split(" ")[0])} />
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      {mode === "month" ? (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="pb-1 text-center font-semibold text-muted-foreground">
              {d}
            </div>
          ))}
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = String(i + 1).padStart(2, "0");
            const date = `${monthPrefix}-${day}`;
            const dayEvents = events.filter((e) => e.date === date);
            return (
              <div key={date} className="min-h-20 rounded-md border border-border p-1">
                <span className="text-[11px] font-semibold text-muted-foreground">{i + 1}</span>
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, 3).map((e, idx) => (
                    <Link
                      key={`${e.recordId}-${idx}`}
                      to="/tracker/$id"
                      params={{ id: e.recordId }}
                      className={cn("block truncate rounded px-1 py-0.5 text-[10px]", KIND_CLASS[e.kind])}
                      title={`${KIND_LABEL[e.kind]}: ${e.label}`}
                    >
                      {e.label}
                    </Link>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 3} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {upcoming.map((e, idx) => (
            <li key={`${e.recordId}-${idx}`} className="flex items-center gap-3 py-2 text-sm">
              <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", KIND_CLASS[e.kind])}>
                {KIND_LABEL[e.kind]}
              </span>
              <Link
                to="/tracker/$id"
                params={{ id: e.recordId }}
                className="font-semibold text-foreground hover:underline"
              >
                {e.label}
              </Link>
              <span className="ml-auto text-muted-foreground">{formatDate(e.date)}</span>
            </li>
          ))}
          {!upcoming.length && (
            <li className="py-8 text-center text-sm text-muted-foreground">No upcoming dates.</li>
          )}
        </ul>
      )}
    </div>
  );
}
