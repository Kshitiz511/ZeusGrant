import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Paperclip,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  STAGES,
  compactMoney,
  daysUntil,
  formatDate,
  recordValue,
  urgencyOf,
  type GrantRecord,
} from "@/lib/tracker";
import { cn } from "@/lib/utils";

/** Cool grey → blue → teal → green → gold ramp across the pipeline. */
const STAGE_STRIPE: Record<string, string> = {
  identified: "bg-slate-400",
  researching: "bg-sky-400",
  drafting: "bg-blue-500",
  ready_to_submit: "bg-indigo-500",
  submitted: "bg-teal-500",
  under_review: "bg-cyan-500",
  info_requested: "bg-emerald-500",
  awarded: "bg-amber-400",
  declined: "bg-rose-400",
  withdrawn: "bg-zinc-400",
  archived: "bg-zinc-300",
};

const STAGE_ORDER: string[] = STAGES.map((s) => s.id);

const FUNDER_TAG: Record<string, string> = {
  federal: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  state: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  local: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  foundation: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  corporate: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  other: "bg-muted text-muted-foreground",
};

type SortId = "deadline" | "match" | "amount" | "added";
type GroupId = "none" | "focus" | "funder_type" | "priority";

const SORTS: { id: SortId; label: string }[] = [
  { id: "deadline", label: "Deadline ↑" },
  { id: "match", label: "Match score ↓" },
  { id: "amount", label: "Award amount ↓" },
  { id: "added", label: "Date added ↓" },
];

const GROUPS: { id: GroupId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "focus", label: "Program area" },
  { id: "funder_type", label: "Funder type" },
  { id: "priority", label: "Priority" },
];

/** Soft WIP guidance for stages where too much parallel work signals overload. */
const WIP_LIMITS: Record<string, number> = { drafting: 5, ready_to_submit: 5 };

function priorityOf(r: GrantRecord): { id: string; label: string; dot: string } {
  const u = urgencyOf(r);
  if (u === "at_risk") return { id: "high", label: "High priority", dot: "bg-red-500" };
  if (u === "attention") return { id: "medium", label: "Medium priority", dot: "bg-orange-500" };
  return { id: "low", label: "Low priority", dot: "bg-muted-foreground/40" };
}

function matchClass(score: number): string {
  if (score >= 85) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (score >= 70) return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  return "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300";
}

function deadlineClass(days: number | null): string {
  if (days === null) return "bg-muted text-muted-foreground";
  if (days <= 14) return "bg-red-500/15 text-red-700 dark:text-red-300";
  if (days <= 30) return "bg-orange-500/15 text-orange-700 dark:text-orange-300";
  return "bg-muted text-muted-foreground";
}

function dueLabel(r: GrantRecord): string {
  if (!r.deadline) return "No deadline";
  const d = new Date(`${r.deadline}T00:00:00Z`);
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function sortCards(cards: GrantRecord[], sort: SortId): GrantRecord[] {
  const out = [...cards];
  out.sort((a, b) => {
    switch (sort) {
      case "deadline":
        return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
      case "match":
        return (b.match_score ?? -1) - (a.match_score ?? -1);
      case "amount":
        return recordValue(b) - recordValue(a);
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });
  return out;
}

function groupsFor(records: GrantRecord[], group: GroupId): string[] {
  if (group === "none") return ["all"];
  const set = new Set<string>();
  for (const r of records) {
    if (group === "focus") (r.focus_areas.length ? r.focus_areas : ["Unassigned"]).forEach((f) => set.add(f));
    else if (group === "funder_type") set.add(r.funder_type || "other");
    else set.add(priorityOf(r).label);
  }
  return [...set].sort();
}

function inGroup(r: GrantRecord, group: GroupId, key: string): boolean {
  if (group === "none") return true;
  if (group === "focus") return (r.focus_areas.length ? r.focus_areas : ["Unassigned"]).includes(key);
  if (group === "funder_type") return (r.funder_type || "other") === key;
  return priorityOf(r).label === key;
}

export function PipelineBoard({
  records,
  onMove,
  onAddNote,
  onAdd,
  documentCounts = {},
}: {
  records: GrantRecord[];
  onMove: (record: GrantRecord, toStage: string) => void;
  onAddNote: (record: GrantRecord) => void;
  onAdd?: (stage: string) => void;
  documentCounts?: Record<string, number>;
}) {
  const navigate = useNavigate();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortId>("deadline");
  const [group, setGroup] = useState<GroupId>("none");
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [backMove, setBackMove] = useState<{ record: GrantRecord; stage: string } | null>(null);
  const [openStages, setOpenStages] = useState<string[]>(["identified", "drafting"]);

  const q = query.trim().toLowerCase();
  const matches = (r: GrantRecord) =>
    !q || r.grant_name.toLowerCase().includes(q) || r.funder.toLowerCase().includes(q);

  const swimlanes = useMemo(() => groupsFor(records, group), [records, group]);

  const attemptMove = (record: GrantRecord, toStage: string) => {
    if (record.stage === toStage) return;
    const backwards = STAGE_ORDER.indexOf(toStage) < STAGE_ORDER.indexOf(record.stage);
    if (backwards) setBackMove({ record, stage: toStage });
    else onMove(record, toStage);
  };

  const card = (r: GrantRecord) => {
    const dim = !matches(r);
    const days = daysUntil(r.deadline);
    const priority = priorityOf(r);
    const docs = documentCounts[r.id] ?? 0;
    const tags = [
      r.funder_type && { label: r.funder_type, cls: FUNDER_TAG[r.funder_type] ?? FUNDER_TAG['other']! },
      ...r.focus_areas.slice(0, 1).map((f) => ({
        label: f,
        cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
      })),
      ...r.tags.slice(0, 1).map((t) => ({ label: t, cls: "bg-muted text-muted-foreground" })),
    ].filter(Boolean) as { label: string; cls: string }[];

    return (
      <article
        key={r.id}
        draggable
        onDragStart={() => setDragId(r.id)}
        onDragEnd={() => setDragId(null)}
        onClick={() => void navigate({ to: "/tracker/$id", params: { id: r.id } })}
        className={cn(
          "group relative cursor-pointer rounded border border-border bg-background p-2.5 transition-all hover:shadow-lift active:cursor-grabbing",
          dragId === r.id && "opacity-40",
          dim && "opacity-30",
        )}
      >
        <GripVertical
          className="absolute -left-1 top-2.5 size-4 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        />
        <div className="flex items-start gap-2">
          <h4
            title={r.grant_name}
            className={cn(
              "min-w-0 flex-1 text-sm font-semibold text-foreground",
              compact ? "truncate" : "line-clamp-2",
            )}
          >
            {r.grant_name}
          </h4>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                aria-label="Card actions"
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link to="/tracker/$id" params={{ id: r.id }}>
                  Open
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onAddNote(r)}>Add note</DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Move to stage</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {STAGES.filter((s) => s.id !== r.stage).map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => attemptMove(r, s.id)}>
                      {s.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => attemptMove(r, "archived")}>Archive</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => attemptMove(r, "withdrawn")}>
                Mark withdrawn
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.funder}</p>

        {!compact && tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {tags.slice(0, 3).map((t, i) => (
              <span
                key={`${t.label}-${i}`}
                className={cn("truncate rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", t.cls)}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          {r.match_score !== null && (
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold",
                matchClass(r.match_score),
              )}
              title={`${r.match_score}% match`}
            >
              {r.match_score}
            </span>
          )}
          <span className="text-xs font-semibold text-foreground">
            {compactMoney(recordValue(r))}
          </span>
          <span
            className={cn("truncate rounded px-1.5 py-0.5 text-[10px] font-semibold", deadlineClass(days))}
            title={r.deadline ? formatDate(r.deadline) : "No deadline"}
          >
            {dueLabel(r)}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {docs > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground" title={`${docs} document(s)`}>
                <Paperclip className="size-3" />
                {docs}
              </span>
            )}
            <span className={cn("size-2 rounded-full", priority.dot)} title={priority.label} />
          </span>
        </div>
      </article>
    );
  };

  const column = (stage: (typeof STAGES)[number], laneKey: string) => {
    const cards = sortCards(
      records.filter((r) => r.stage === stage.id && inGroup(r, group, laneKey)),
      sort,
    );
    const limit = WIP_LIMITS[stage.id];
    const over = limit !== undefined && cards.length > limit;
    return (
      <section
        key={`${laneKey}-${stage.id}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOverStage(stage.id);
        }}
        onDragLeave={() => setOverStage((s) => (s === stage.id ? null : s))}
        onDrop={() => {
          const record = records.find((r) => r.id === dragId);
          setOverStage(null);
          setDragId(null);
          if (record) attemptMove(record, stage.id);
        }}
        className={cn(
          "flex w-72 shrink-0 flex-col rounded-lg border border-transparent bg-muted/60",
          overStage === stage.id && "border-primary bg-primary/5",
        )}
        aria-label={stage.label}
      >
        <span className={cn("h-1 rounded-t-lg", STAGE_STRIPE[stage.id] ?? "bg-border")} />
        <header className="flex items-center gap-2 px-3 py-2">
          <h3 className="truncate text-xs font-bold uppercase tracking-wide text-foreground">
            {stage.label}
          </h3>
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold",
              over ? "bg-destructive text-destructive-foreground" : "bg-background text-muted-foreground",
            )}
            title={limit !== undefined ? `Work-in-progress limit ${limit}` : undefined}
          >
            {limit !== undefined ? `${cards.length}/${limit}` : cards.length}
          </span>
        </header>

        <div className="flex-1 space-y-2 px-2 pb-2">
          {cards.map(card)}
          {dragId && overStage === stage.id && (
            <div className="h-16 rounded border border-dashed border-primary/60 bg-primary/5" />
          )}
          {!cards.length && (
            <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center">
              <p className="text-xs text-muted-foreground">No grants in {stage.label}</p>
              {onAdd && (
                <button
                  onClick={() => onAdd(stage.id)}
                  className="mt-1 text-xs font-semibold text-primary hover:underline"
                >
                  + Add grant to this stage
                </button>
              )}
            </div>
          )}
        </div>

        {onAdd && (
          <button
            onClick={() => onAdd(stage.id)}
            className="px-3 pb-2 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            + Add
          </button>
        )}
      </section>
    );
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <p className="text-sm font-bold text-foreground">
          Pipeline{" "}
          <span className="font-normal text-muted-foreground">
            · {records.length} grant{records.length === 1 ? "" : "s"} tracked
          </span>
        </p>
        <div className="relative min-w-52 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search grant or funder"
            className="h-9 pl-8"
            aria-label="Search pipeline"
          />
        </div>
        <Select value={group} onValueChange={(v) => setGroup(v as GroupId)}>
          <SelectTrigger className="h-9 w-44" aria-label="Group by">
            <SelectValue placeholder="Group by" />
          </SelectTrigger>
          <SelectContent>
            {GROUPS.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                Group by: {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as SortId)}>
          <SelectTrigger className="h-9 w-44" aria-label="Sort within columns">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                Sort: {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={compact ? "default" : "outline"}
          size="sm"
          onClick={() => setCompact((c) => !c)}
          aria-pressed={compact}
        >
          Compact
        </Button>
        {onAdd && (
          <Button variant="hero" size="sm" onClick={() => onAdd("identified")}>
            <Plus className="mr-1 size-4" /> Add grant
          </Button>
        )}
      </div>

      {/* Desktop board */}
      <div className="hidden lg:block">
        {swimlanes.map((lane) => {
          const isCollapsed = collapsed.includes(lane);
          return (
            <div key={lane} className="mb-4">
              {group !== "none" && (
                <button
                  onClick={() =>
                    setCollapsed((c) => (c.includes(lane) ? c.filter((x) => x !== lane) : [...c, lane]))
                  }
                  className="sticky left-0 mb-2 flex w-full items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-left text-xs font-bold uppercase tracking-wide text-foreground"
                >
                  {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                  {lane}
                  <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {records.filter((r) => inGroup(r, group, lane)).length}
                  </span>
                </button>
              )}
              {!isCollapsed && (
                <div className="flex gap-3 overflow-x-auto pb-3">
                  {STAGES.map((stage) => column(stage, lane))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: stage accordion */}
      <div className="space-y-2 lg:hidden">
        {STAGES.map((stage) => {
          const cards = sortCards(
            records.filter((r) => r.stage === stage.id && matches(r)),
            sort,
          );
          const open = openStages.includes(stage.id);
          return (
            <div key={stage.id} className="overflow-hidden rounded-lg border border-border">
              <span className={cn("block h-1", STAGE_STRIPE[stage.id] ?? "bg-border")} />
              <button
                onClick={() =>
                  setOpenStages((s) =>
                    s.includes(stage.id) ? s.filter((x) => x !== stage.id) : [...s, stage.id],
                  )
                }
                className="flex w-full items-center gap-2 bg-card px-3 py-2.5 text-left"
              >
                {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                <span className="text-sm font-bold text-foreground">{stage.label}</span>
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                  {cards.length}
                </span>
              </button>
              {open && (
                <div className="space-y-2 bg-muted/50 p-2">
                  {cards.map(card)}
                  {!cards.length && (
                    <p className="py-4 text-center text-xs text-muted-foreground">
                      No grants in {stage.label}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Backward move confirmation */}
      <Dialog open={!!backMove} onOpenChange={(o) => !o && setBackMove(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Move back a stage?</DialogTitle>
            <DialogDescription>
              Move {backMove?.record.grant_name} back to{" "}
              {STAGES.find((s) => s.id === backMove?.stage)?.label}? This will update the grant's
              stage.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setBackMove(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (backMove) onMove(backMove.record, backMove.stage);
                setBackMove(null);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
