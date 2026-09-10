import { useMemo, useState } from "react";
import { AlarmClock, GripVertical, MessageSquare, Paperclip, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BOARD_LANES,
  CATEGORY_CLASS,
  CATEGORY_LABEL,
  OBLIGATION_CATEGORIES,
  PRIORITIES,
  daysUntil,
  formatDate,
  laneOf,
  type ComplianceDocument,
  type ComplianceObligation,
} from "@/lib/compliance";
import { cn } from "@/lib/utils";

export function ObligationBoard({
  obligations,
  evidence = [],
  commentCounts,
  onStatusChange,
  onSelect,
}: {
  obligations: ComplianceObligation[];
  evidence?: ComplianceDocument[];
  commentCounts?: Map<string, number>;
  onStatusChange: (o: ComplianceObligation, status: string) => void;
  onSelect: (o: ComplianceObligation) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [window, setWindow] = useState("all");

  const evidenceCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of evidence) {
      if (d.obligation_id) map.set(d.obligation_id, (map.get(d.obligation_id) ?? 0) + 1);
    }
    return map;
  }, [evidence]);

  const assignees = useMemo(
    () => Array.from(new Set(obligations.map((o) => o.assignee_name).filter(Boolean) as string[])),
    [obligations],
  );

  const visible = obligations.filter((o) => {
    if (category !== "all" && o.category !== category) return false;
    if (priority !== "all" && o.priority !== priority) return false;
    if (assignee !== "all" && o.assignee_name !== assignee) return false;
    if (window !== "all") {
      const d = daysUntil(o.due_date);
      if (d === null || d < 0 || d > Number(window)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Filter value={category} onChange={setCategory} label="All categories">
          {OBLIGATION_CATEGORIES.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.label}
            </SelectItem>
          ))}
        </Filter>
        <Filter value={priority} onChange={setPriority} label="Any priority">
          {PRIORITIES.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </Filter>
        <Filter value={assignee} onChange={setAssignee} label="Anyone">
          {assignees.map((a) => (
            <SelectItem key={a} value={a}>
              {a}
            </SelectItem>
          ))}
        </Filter>
        <Filter value={window} onChange={setWindow} label="Any due date">
          <SelectItem value="7">Due within 7 days</SelectItem>
          <SelectItem value="30">Due within 30 days</SelectItem>
          <SelectItem value="90">Due within 90 days</SelectItem>
        </Filter>
      </div>

      <div className="-mx-1 flex gap-4 overflow-x-auto pb-4">
        {BOARD_LANES.map((lane) => {
          const cards = visible.filter((o) => laneOf(o) === lane.id);
          return (
            <section
              key={lane.id}
              aria-label={lane.label}
              onDragOver={(e) => {
                if (lane.id === "overdue") return;
                e.preventDefault();
                setOver(lane.id);
              }}
              onDragLeave={() => setOver((s) => (s === lane.id ? null : s))}
              onDrop={() => {
                const o = obligations.find((x) => x.id === dragId);
                setOver(null);
                setDragId(null);
                if (o && lane.id !== "overdue" && o.status !== lane.id) {
                  onStatusChange(o, lane.id);
                }
              }}
              className={cn(
                "w-72 shrink-0 lg:w-auto lg:min-w-0 lg:flex-1 rounded-xl border border-border bg-card p-3 transition-colors",
                over === lane.id && "border-primary bg-primary/5",
                lane.id === "overdue" && "border-destructive/40",
              )}
            >
              <header className="mb-3 px-1">
                <h3 className="text-sm font-bold text-foreground">{lane.label}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{cards.length} tasks</p>
              </header>

              <div className="space-y-2">
                {cards.map((o) => {
                  const d = daysUntil(o.due_date);
                  const urgent = d !== null && d <= 7;
                  const attachments = evidenceCount.get(o.id) ?? 0;
                  const comments = commentCounts?.get(o.id) ?? 0;
                  return (
                    <article
                      key={o.id}
                      draggable
                      onDragStart={() => setDragId(o.id)}
                      onDragEnd={() => setDragId(null)}
                      className={cn(
                        "cursor-grab rounded-lg border border-border bg-background p-3 active:cursor-grabbing",
                        dragId === o.id && "opacity-50",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          title={CATEGORY_LABEL[o.category] ?? o.category}
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            CATEGORY_CLASS[o.category] ?? "bg-muted-foreground",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => onSelect(o)}
                          className="min-w-0 flex-1 text-left text-sm font-semibold text-foreground hover:underline"
                        >
                          {o.title}
                        </button>
                        <GripVertical className="size-4 shrink-0 text-muted-foreground/50" />
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary" className="text-[11px]">
                          {CATEGORY_LABEL[o.category] ?? o.category}
                        </Badge>
                        <Badge
                          variant={o.priority === "high" ? "destructive" : "outline"}
                          className="text-[11px] capitalize"
                        >
                          {o.priority}
                        </Badge>
                        {o.prior_approval_required && (
                          <Badge variant="destructive" className="text-[11px]">
                            Prior approval
                          </Badge>
                        )}
                        {o.assignee_name && (
                          <Badge variant="outline" className="text-[11px]">
                            {o.assignee_name}
                          </Badge>
                        )}
                      </div>

                      <p
                        className={cn(
                          "mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground",
                          urgent && "font-semibold text-destructive",
                        )}
                      >
                        <span className="inline-flex items-center gap-1">
                          <AlarmClock className="size-3" /> {formatDate(o.due_date)}
                        </span>
                        {o.recurrence !== "one_time" && (
                          <span className="inline-flex items-center gap-1">
                            <Repeat className="size-3" /> {o.recurrence.replace(/_/g, " ")}
                          </span>
                        )}
                        {attachments > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Paperclip className="size-3" /> {attachments}
                          </span>
                        )}
                        {comments > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="size-3" /> {comments}
                          </span>
                        )}
                      </p>
                    </article>
                  );
                })}
                {!cards.length && (
                  <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing here
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Filter({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{label}</SelectItem>
        {children}
      </SelectContent>
    </Select>
  );
}
