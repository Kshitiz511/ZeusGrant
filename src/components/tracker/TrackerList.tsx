import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpDown, Download, Lock } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FUNDER_TYPES,
  OUTCOMES,
  STAGES,
  STAGE_LABEL,
  downloadFile,
  formatDate,
  formatMoney,
  toCsv,
  type GrantRecord,
} from "@/lib/tracker";
import { toast } from "sonner";

type SortKey = keyof Pick<
  GrantRecord,
  | "grant_name"
  | "funder"
  | "funder_type"
  | "requested_amount"
  | "awarded_amount"
  | "stage"
  | "submission_date"
  | "decision_date_actual"
  | "match_score"
  | "last_activity_at"
>;

export function TrackerList({
  records,
  canExport,
}: {
  records: GrantRecord[];
  canExport: boolean;
}) {
  const [stage, setStage] = useState("all");
  const [funderType, setFunderType] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "last_activity_at",
    dir: "desc",
  });

  const filtered = useMemo(() => {
    const rows = records.filter((r) => {
      if (stage !== "all" && r.stage !== stage) return false;
      if (funderType !== "all" && r.funder_type !== funderType) return false;
      if (outcome !== "all" && r.outcome !== outcome) return false;
      const ref = r.submission_date ?? r.deadline ?? r.created_at.slice(0, 10);
      if (from && ref < from) return false;
      if (to && ref > to) return false;
      if (minAmount && Number(r.requested_amount ?? 0) < Number(minAmount)) return false;
      return true;
    });

    return rows.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const an = av === null || av === undefined ? "" : av;
      const bn = bv === null || bv === undefined ? "" : bv;
      if (an === bn) return 0;
      const cmp = an > bn ? 1 : -1;
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [records, stage, funderType, outcome, from, to, minAmount, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));

  const exportCsv = () => {
    if (!canExport) {
      toast.error("CSV export is available on Growth and above.");
      return;
    }
    downloadFile(
      toCsv(
        filtered.map((r) => ({
          "Grant Name": r.grant_name,
          Funder: r.funder,
          Type: r.funder_type,
          "Requested Amount": r.requested_amount ?? "",
          "Awarded Amount": r.awarded_amount ?? "",
          Stage: STAGE_LABEL[r.stage] ?? r.stage,
          "Submission Date": r.submission_date ?? "",
          "Decision Date": r.decision_date_actual ?? "",
          "Match Score": r.match_score ?? "",
          Outcome: r.outcome,
          "Last Activity": r.last_activity_at.slice(0, 10),
        })),
      ),
      `grant-tracker-${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv",
    );
  };

  const header = (key: SortKey, label: string) => (
    <TableHead>
      <button
        className="inline-flex items-center gap-1 font-semibold hover:text-foreground"
        onClick={() => toggleSort(key)}
      >
        {label}
        <ArrowUpDown className="size-3" />
      </button>
    </TableHead>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={funderType} onValueChange={setFunderType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Funder type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All funder types</SelectItem>
            {FUNDER_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any outcome</SelectItem>
            {OUTCOMES.map((o) => (
              <SelectItem key={o} value={o} className="capitalize">
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        <Input
          type="number"
          min="0"
          placeholder="Min amount"
          className="w-36"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
        />

        <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv}>
          {canExport ? <Download className="mr-2 size-4" /> : <Lock className="mr-2 size-4" />}
          Export CSV
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {header("grant_name", "Grant")}
              {header("funder", "Funder")}
              {header("funder_type", "Type")}
              {header("requested_amount", "Requested")}
              {header("awarded_amount", "Awarded")}
              {header("stage", "Stage")}
              {header("submission_date", "Submitted")}
              {header("decision_date_actual", "Decision")}
              {header("match_score", "Fit")}
              {header("last_activity_at", "Last activity")}
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-semibold text-foreground">{r.grant_name}</TableCell>
                <TableCell>{r.funder}</TableCell>
                <TableCell className="capitalize">{r.funder_type}</TableCell>
                <TableCell>{formatMoney(r.requested_amount)}</TableCell>
                <TableCell>{formatMoney(r.awarded_amount)}</TableCell>
                <TableCell>{STAGE_LABEL[r.stage] ?? r.stage}</TableCell>
                <TableCell>{formatDate(r.submission_date)}</TableCell>
                <TableCell>{formatDate(r.decision_date_actual)}</TableCell>
                <TableCell>{r.match_score === null ? "—" : `${r.match_score}%`}</TableCell>
                <TableCell>{formatDate(r.last_activity_at)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/tracker/$id" params={{ id: r.id }}>
                      Open
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">
                  No grants match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
