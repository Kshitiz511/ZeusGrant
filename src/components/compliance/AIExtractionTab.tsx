import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_CLASS,
  CATEGORY_LABEL,
  CONFIDENCE_CLASS,
  CONTRACT_UPLOAD_TYPES,
  EXTRACTION_MODEL,
  OBLIGATION_CATEGORIES,
  REVIEW_ACTION_CLASS,
  REVIEW_ACTION_LABEL,
  STATUS_LABEL,
  confidenceLevel,
  extractText,
  formatDate,
  parseRawExtraction,
  type ComplianceContract,
  type ComplianceObligation,
  type ExtractedContract,
  type ExtractedObligation,
  type ReviewAction,
} from "@/lib/compliance";
import { extractContract } from "@/utils/compliance.functions";

type RunRow = {
  id: string;
  model: string | null;
  source_label: string | null;
  is_original: boolean;
  extraction: unknown;
  created_at: string;
};

type Row = {
  index: number;
  ai: ExtractedObligation;
  live: ComplianceObligation | null;
  action: ReviewAction;
};

export function AIExtractionTab({
  contract,
  obligations,
  userId,
  onChanged,
}: {
  contract: ComplianceContract;
  obligations: ComplianceObligation[];
  userId: string;
  onChanged: () => void;
}) {
  const runExtract = useServerFn(extractContract);
  const raw = useMemo(() => parseRawExtraction(contract.raw_extraction), [contract.raw_extraction]);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [category, setCategory] = useState("all");
  const [action, setAction] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [rerunText, setRerunText] = useState("");
  const [rerunBusy, setRerunBusy] = useState(false);
  const [compareRunId, setCompareRunId] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    const { data } = await supabase
      .from("compliance_extraction_runs")
      .select("*")
      .eq("contract_id", contract.id)
      .order("created_at", { ascending: false });
    setRuns((data as RunRow[]) ?? []);
  }, [contract.id]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const rows: Row[] = useMemo(() => {
    if (!raw) return [];
    return raw.extraction.obligations.map((ai, index) => {
      const live =
        obligations.find((o) => o.extraction_index === index) ??
        obligations.find((o) => o.title === ai.title && o.extraction_source === "ai") ??
        null;
      const act = (live?.user_review_action as ReviewAction | null) ?? "removed_by_user";
      return { index, ai, live, action: act };
    });
  }, [raw, obligations]);

  const manualRows = useMemo(
    () => obligations.filter((o) => o.extraction_source === "manual"),
    [obligations],
  );

  const counts = useMemo(() => {
    const c = { accepted: 0, edited: 0, removed_by_user: 0, manually_added: manualRows.length };
    rows.forEach((r) => {
      if (r.action === "accepted") c.accepted += 1;
      else if (r.action === "edited") c.edited += 1;
      else c.removed_by_user += 1;
    });
    return c;
  }, [rows, manualRows]);

  const filtered = rows.filter(
    (r) =>
      (category === "all" || r.ai.category === category) &&
      (action === "all" ||
        (action === "accepted" && r.action === "accepted") ||
        (action === "edited" && r.action === "edited") ||
        (action === "removed" && r.action === "removed_by_user")),
  );

  const currentStatus = (o: ComplianceObligation | null): string => {
    if (!o || o.status === "removed") return "—";
    if (
      o.due_date &&
      !["complete", "waived", "not_applicable"].includes(o.status) &&
      new Date(o.due_date) < new Date()
    )
      return "Overdue";
    return STATUS_LABEL[o.status] ?? o.status;
  };

  const restore = async (row: Row) => {
    setImporting(`row-${row.index}`);
    try {
      if (row.live) {
        const { error } = await supabase
          .from("compliance_obligations")
          .update({
            status: "not_started",
            confirmed: true,
            user_review_action: "accepted",
          })
          .eq("id", row.live.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("compliance_obligations").insert({
          contract_id: contract.id,
          user_id: userId,
          category: row.ai.category || "administrative",
          title: row.ai.title || "Untitled obligation",
          description: row.ai.description,
          due_date: row.ai.due_date,
          recurrence: row.ai.recurrence || "one_time",
          priority: row.ai.priority || "medium",
          prior_approval_required: !!row.ai.prior_approval_required,
          amount: row.ai.amount,
          source_quote: row.ai.source_quote,
          source_page: row.ai.source_page,
          confidence: row.ai.confidence,
          confirmed: true,
          status: "not_started",
          sort_order: obligations.length,
          extraction_source: "ai",
          extraction_index: row.index,
          user_review_action: "accepted",
          original_ai_text: row.ai.description,
          original_ai_due_date: row.ai.due_date,
        });
        if (error) throw new Error(error.message);
      }
      toast.success("Restored as an active task.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not restore that obligation");
    } finally {
      setImporting(null);
    }
  };

  const importFromRun = async (o: ExtractedObligation, key: string) => {
    setImporting(key);
    try {
      const { error } = await supabase.from("compliance_obligations").insert({
        contract_id: contract.id,
        user_id: userId,
        category: o.category || "administrative",
        title: o.title || "Untitled obligation",
        description: o.description,
        due_date: o.due_date,
        recurrence: o.recurrence || "one_time",
        priority: o.priority || "medium",
        prior_approval_required: !!o.prior_approval_required,
        amount: o.amount,
        source_quote: o.source_quote,
        source_page: o.source_page,
        confidence: o.confidence,
        confirmed: true,
        status: "not_started",
        sort_order: obligations.length,
        extraction_source: "ai",
        user_review_action: "accepted",
        original_ai_text: o.description,
        original_ai_due_date: o.due_date,
      });
      if (error) throw new Error(error.message);
      toast.success("Imported into the task list.");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not import that obligation");
    } finally {
      setImporting(null);
    }
  };

  const runAgain = async (text: string, label: string) => {
    if (text.trim().length < 50) {
      toast.error("We need more contract text than that.");
      return;
    }
    setRerunBusy(true);
    try {
      const result = await runExtract({ data: { text, fileName: label } });
      const { error } = await supabase.from("compliance_extraction_runs").insert({
        contract_id: contract.id,
        user_id: userId,
        model: EXTRACTION_MODEL,
        source_label: label,
        is_original: false,
        extraction: result as never,
      });
      if (error) throw new Error(error.message);
      toast.success("New extraction run saved. The original is untouched.");
      setRerunOpen(false);
      setRerunText("");
      await loadRuns();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not re-run the extraction");
    } finally {
      setRerunBusy(false);
    }
  };

  if (!raw) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center">
        <h3 className="text-lg font-bold text-foreground">No saved AI extraction</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          This contract was imported before extraction snapshots were saved, or the obligations were
          entered manually. Run the AI on the contract text to create a permanent record.
        </p>
        <div className="mx-auto mt-5 max-w-xl space-y-2 text-left">
          <Textarea
            rows={6}
            placeholder="Paste the contract text…"
            value={rerunText}
            onChange={(e) => setRerunText(e.target.value)}
          />
          <Button
            variant="hero"
            disabled={rerunBusy}
            onClick={() => void runAgain(rerunText, contract.file_name ?? contract.name)}
          >
            {rerunBusy ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            Run extraction
          </Button>
        </div>
      </div>
    );
  }

  const compareRun = runs.find((r) => r.id === compareRunId);
  const compareObligations =
    (compareRun?.extraction as ExtractedContract | undefined)?.obligations ?? [];

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI extraction record
          </p>
          <p className="text-foreground">
            Run {new Date(raw.extracted_at).toLocaleString()} · model{" "}
            <span className="font-mono text-xs">{raw.model || contract.extraction_model}</span>
          </p>
          <p className="text-foreground">
            Total obligations found by AI: <strong>{rows.length}</strong>
          </p>
          <p className="text-muted-foreground">
            {counts.accepted} accepted as-is · {counts.edited} accepted with edits ·{" "}
            {counts.removed_by_user} removed by user · {counts.manually_added} manually added
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setRerunOpen((v) => !v)}>
          <Sparkles className="mr-2 size-4" /> Re-run extraction
        </Button>
      </section>

      {rerunOpen && (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Re-running never overwrites the original record — it saves a new, timestamped run you can
            compare against and import from selectively.
          </p>
          <Textarea
            rows={5}
            placeholder="Paste the amended contract text…"
            value={rerunText}
            onChange={(e) => setRerunText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:border-primary">
              <FileUp className="size-4" /> Upload amended file
              <input
                type="file"
                className="hidden"
                accept={CONTRACT_UPLOAD_TYPES}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  void (async () => {
                    try {
                      const text = await extractText(f);
                      await runAgain(text, f.name);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not read that file");
                    }
                  })();
                }}
              />
            </label>
            <Button
              variant="hero"
              size="sm"
              disabled={rerunBusy}
              onClick={() => void runAgain(rerunText, "Re-run (pasted text)")}
            >
              {rerunBusy && <Loader2 className="mr-2 size-4 animate-spin" />}
              Run again
            </Button>
          </div>
        </section>
      )}

      {runs.length > 1 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Extraction runs</p>
            {runs.map((r) => (
              <Badge key={r.id} variant={r.is_original ? "secondary" : "outline"}>
                {r.is_original ? "Original" : "Re-run"} ·{" "}
                {new Date(r.created_at).toLocaleDateString()}
              </Badge>
            ))}
            <Select value={compareRunId ?? "none"} onValueChange={(v) => setCompareRunId(v === "none" ? null : v)}>
              <SelectTrigger className="ml-auto w-56">
                <SelectValue placeholder="Compare a run" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Compare off</SelectItem>
                {runs
                  .filter((r) => !r.is_original)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Re-run {new Date(r.created_at).toLocaleString()}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {compareRun && (
            <div className="mt-4 space-y-2">
              <p className="text-xs text-muted-foreground">
                {compareObligations.length} obligations in this run. Import individual items without
                replacing anything you already track.
              </p>
              {compareObligations.map((o, i) => {
                const isNew = !rows.some((r) => r.ai.title === o.title);
                return (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
                  >
                    <Badge variant="secondary">{CATEGORY_LABEL[o.category] ?? o.category}</Badge>
                    <span className="min-w-0 flex-1 truncate text-foreground">{o.title}</span>
                    {isNew && <Badge variant="outline">New in this run</Badge>}
                    <span className="text-xs text-muted-foreground">{formatDate(o.due_date)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={importing === `run-${i}`}
                      onClick={() => void importFromRun(o, `run-${i}`)}
                    >
                      Import
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {OBLIGATION_CATEGORIES.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Review action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All review actions</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
            <SelectItem value="removed">Removed</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing {filtered.length} of {rows.length}
        </span>
      </section>

      <section className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3">#</th>
              <th className="p-3">Category</th>
              <th className="p-3">AI-extracted obligation</th>
              <th className="p-3">Original due date</th>
              <th className="p-3">Confidence</th>
              <th className="p-3">Review action</th>
              <th className="p-3">Current status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const level = confidenceLevel(r.ai.confidence);
              const open = expanded === r.index;
              const removed = r.action === "removed_by_user";
              return (
                <Fragment key={r.index}>
                  <tr
                    className="cursor-pointer border-t border-border hover:bg-muted/40"
                    onClick={() => setExpanded(open ? null : r.index)}
                  >
                    <td className="p-3 align-top text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        {open ? (
                          <ChevronDown className="size-3.5" />
                        ) : (
                          <ChevronRight className="size-3.5" />
                        )}
                        {r.index + 1}
                      </span>
                    </td>
                    <td className="p-3 align-top">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span
                          className={`size-2 rounded-full ${CATEGORY_CLASS[r.ai.category] ?? "bg-muted-foreground"}`}
                        />
                        {CATEGORY_LABEL[r.ai.category] ?? r.ai.category}
                      </span>
                    </td>
                    <td className="max-w-md p-3 align-top">
                      <p className={removed ? "text-muted-foreground line-through" : "text-foreground"}>
                        {r.ai.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {r.ai.description}
                      </p>
                      {r.action === "edited" && (
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          edited
                        </Badge>
                      )}
                    </td>
                    <td className="p-3 align-top text-muted-foreground">
                      {formatDate(r.ai.due_date)}
                    </td>
                    <td className="p-3 align-top">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${CONFIDENCE_CLASS[level]}`}
                      >
                        {level}
                      </span>
                    </td>
                    <td className="p-3 align-top">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${REVIEW_ACTION_CLASS[r.action]}`}
                      >
                        {REVIEW_ACTION_LABEL[r.action]}
                      </span>
                    </td>
                    <td className="p-3 align-top text-muted-foreground">{currentStatus(r.live)}</td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border bg-muted/20">
                      <td colSpan={7} className="space-y-3 p-4 text-sm">
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            AI-extracted description
                          </p>
                          <p className="text-foreground">{r.ai.description || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase text-muted-foreground">
                            Original contract quote
                          </p>
                          <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
                            “{r.ai.source_quote || "No quote captured"}”
                          </blockquote>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.ai.source_page !== null
                              ? `Page ${r.ai.source_page}`
                              : "No page reference in the document"}
                          </p>
                        </div>
                        {r.action === "edited" && r.live && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-border p-3">
                              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                AI original
                              </p>
                              <p className="text-foreground">
                                {r.live.original_ai_text ?? r.ai.description}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Due {formatDate(r.live.original_ai_due_date ?? r.ai.due_date)}
                              </p>
                            </div>
                            <div className="rounded-lg border border-primary/40 p-3">
                              <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                                User version
                              </p>
                              <p className="text-foreground">{r.live.description ?? "—"}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Due {formatDate(r.live.due_date)}
                              </p>
                            </div>
                          </div>
                        )}
                        {removed ? (
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-muted-foreground">
                              Removed during review — not tracked as a task.
                            </p>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={importing === `row-${r.index}`}
                              onClick={() => void restore(r)}
                            >
                              <RotateCcw className="mr-2 size-4" /> Restore as task
                            </Button>
                          </div>
                        ) : (
                          r.live && (
                            <p className="text-xs text-muted-foreground">
                              Tracked as an active task — manage it on the Task Board or Task List.
                            </p>
                          )
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {manualRows.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">
            Manually added by user ({manualRows.length})
          </p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {manualRows.map((o) => (
              <li key={o.id}>
                {o.title} · {formatDate(o.due_date)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="rounded-lg border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
        This is a permanent record of the AI&apos;s original analysis of your contract. It cannot be
        edited here. Go to the Task Board or Task List to manage active obligations.
      </p>
    </div>
  );
}
