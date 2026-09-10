import { useMemo, useState } from "react";
import { ArrowUpDown, Download, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORY_LABEL,
  OBLIGATION_STATUSES,
  STATUS_LABEL,
  formatDate,
  riskOf,
  type ComplianceDocument,
  type ComplianceObligation,
} from "@/lib/compliance";
import { cn } from "@/lib/utils";

type SortKey = "title" | "category" | "due_date" | "status" | "priority" | "updated_at";

export function TaskListView({
  obligations,
  evidence,
  onSelect,
  onBulkStatus,
  onExportCsv,
  canExport,
}: {
  obligations: ComplianceObligation[];
  evidence: ComplianceDocument[];
  onSelect: (o: ComplianceObligation) => void;
  onBulkStatus: (ids: string[], status: string) => void;
  onExportCsv: () => void;
  canExport: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({
    key: "due_date",
    asc: true,
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("in_progress");

  const evidenceCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of evidence) {
      if (d.obligation_id) map.set(d.obligation_id, (map.get(d.obligation_id) ?? 0) + 1);
    }
    return map;
  }, [evidence]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = obligations.filter(
      (o) =>
        !q ||
        o.title.toLowerCase().includes(q) ||
        (o.description ?? "").toLowerCase().includes(q),
    );
    const dir = sort.asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = String(a[sort.key] ?? "");
      const bv = String(b[sort.key] ?? "");
      return av.localeCompare(bv) * dir;
    });
  }, [obligations, query, sort]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const header = (key: SortKey, label: string) => (
    <th className="whitespace-nowrap px-3 py-2 text-left">
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}
      >
        {label} <ArrowUpDown className="size-3" />
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tasks"
          className="max-w-xs"
        />
        {selected.length > 0 && (
          <>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBLIGATION_STATUSES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onBulkStatus(selected, bulkStatus);
                setSelected([]);
              }}
            >
              Update {selected.length} task(s)
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={!canExport}
          onClick={onExportCsv}
        >
          <Download className="mr-2 size-4" /> CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-xs text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2" />
              {header("title", "Task")}
              {header("category", "Category")}
              {header("due_date", "Due")}
              <th className="px-3 py-2 text-left">Recurrence</th>
              <th className="px-3 py-2 text-left">Assigned to</th>
              {header("status", "Status")}
              {header("priority", "Priority")}
              <th className="px-3 py-2 text-left">Evidence</th>
              {header("updated_at", "Updated")}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const overdue = riskOf(o) === "overdue";
              return (
                <tr key={o.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${o.title}`}
                      checked={selected.includes(o.id)}
                      onChange={() => toggle(o.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-left font-medium text-foreground hover:underline"
                      onClick={() => onSelect(o)}
                    >
                      {o.title}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-[11px]">
                      {CATEGORY_LABEL[o.category] ?? o.category}
                    </Badge>
                  </td>
                  <td className={cn("px-3 py-2", overdue && "font-semibold text-destructive")}>
                    {formatDate(o.due_date)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {o.recurrence === "one_time" ? "—" : o.recurrence.replace(/_/g, " ")}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{o.assignee_name ?? "—"}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[o.status] ?? o.status}</td>
                  <td className="px-3 py-2 capitalize text-muted-foreground">{o.priority}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {evidenceCount.get(o.id) ? (
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="size-3" />
                        {evidenceCount.get(o.id)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(o.updated_at).toLocaleDateString()}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
                  No tasks match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
