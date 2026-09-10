import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { FileUp, Loader2, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_LABEL,
  COMPENSATION_TYPES,
  CONTRACT_UPLOAD_TYPES,
  EXTRACTION_MODEL,
  OBLIGATION_CATEGORIES,
  extractText,
  money,
  parseRawExtraction,
  reviewActionFor,
  toReviewDraft,
  type ComplianceContract,
  type ExtractedContract,
  type ExtractedObligation,
  type ReviewDraft,
  type ReviewObligation,
} from "@/lib/compliance";
import { extractContract, fetchContractUrl } from "@/utils/compliance.functions";

type Step = "upload" | "review";

export function ContractUploadDialog({
  open,
  onOpenChange,
  userId,
  onCreated,
  resume = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  userId: string;
  onCreated: () => void;
  /** A contract whose extraction is saved but whose review was never completed. */
  resume?: ComplianceContract | null;
}) {
  const navigate = useNavigate();
  const runExtract = useServerFn(extractContract);
  const runFetchUrl = useServerFn(fetchContractUrl);

  const [step, setStep] = useState<Step>("upload");
  const [mode, setMode] = useState<"file" | "url" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ReviewDraft | null>(null);
  const [aiOriginal, setAiOriginal] = useState<ExtractedContract | null>(null);
  const [contractId, setContractId] = useState<string | null>(null);
  const dirty = useRef(false);

  const reset = () => {
    setStep("upload");
    setMode("file");
    setFile(null);
    setSourceUrl("");
    setPasted("");
    setDraft(null);
    setAiOriginal(null);
    setContractId(null);
    setBusy(false);
    setSaving(false);
    dirty.current = false;
  };

  // Resume a review that was abandoned mid-way: the extraction is already in the DB.
  useEffect(() => {
    if (!open || !resume) return;
    const raw = parseRawExtraction(resume.raw_extraction);
    if (!raw) return;
    setAiOriginal(raw.extraction);
    setDraft(raw.review_draft ?? toReviewDraft(raw.extraction));
    setContractId(resume.id);
    setStep("review");
  }, [open, resume]);

  // Autosave review-screen progress into raw_extraction.review_draft.
  useEffect(() => {
    if (!contractId || !draft || !aiOriginal || step !== "review" || !dirty.current) return;
    const id = window.setTimeout(() => {
      void supabase
        .from("compliance_contracts")
        .update({
          raw_extraction: {
            model: EXTRACTION_MODEL,
            extracted_at: new Date().toISOString(),
            source_label: file?.name ?? sourceUrl ?? "Pasted contract text",
            extraction: aiOriginal,
            review_draft: draft,
          } as never,
        })
        .eq("id", contractId);
    }, 800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, contractId, aiOriginal, step]);

  const close = (v: boolean) => {
    if (!v) {
      if (contractId && step === "review") {
        toast.info("Your extraction is saved. Resume the review any time from Contract Compliance.");
        onCreated();
      }
      reset();
    }
    onOpenChange(v);
  };

  const canExtract =
    mode === "file" ? !!file : mode === "url" ? sourceUrl.trim().length > 8 : pasted.trim().length > 50;

  const handleExtract = async () => {
    if (!canExtract) return;
    setBusy(true);
    try {
      let text = "";
      let fileName = "contract";
      if (mode === "file" && file) {
        text = await extractText(file);
        fileName = file.name;
      } else if (mode === "url") {
        const fetched = await runFetchUrl({ data: { url: sourceUrl.trim() } });
        text = fetched.text;
        fileName = fetched.fileName;
      } else {
        text = pasted;
        fileName = "Pasted contract text";
      }
      const result = await runExtract({ data: { text, fileName } });

      // Persist the raw extraction immediately, before the review screen appears.
      let storagePath: string | null = null;
      if (file) {
        storagePath = `${userId}/contracts/${crypto.randomUUID()}-${file.name}`;
        const upload = await supabase.storage.from("grant-documents").upload(storagePath, file);
        if (upload.error) throw new Error(upload.error.message);
      }

      const savedAt = new Date().toISOString();
      const payload = {
        model: EXTRACTION_MODEL,
        extracted_at: savedAt,
        source_label: fileName,
        extraction: result,
        review_draft: toReviewDraft(result),
      };

      const { data: contract, error } = await supabase
        .from("compliance_contracts")
        .insert({
          user_id: userId,
          name: result.name || fileName || "Untitled contract",
          funder: result.funder ?? "",
          contract_number: result.contract_number,
          award_amount: result.award_amount,
          period_start: result.period_start,
          period_end: result.period_end,
          compensation_type: result.compensation_type || "lump_sum",
          lump_sum_amount: result.lump_sum_amount,
          reimbursable_cap: result.reimbursable_cap,
          reimbursable_multiplier: result.reimbursable_multiplier,
          invoicing_basis: result.invoicing_basis,
          extraction_status: "complete",
          extraction_summary: result.summary,
          extraction_model: EXTRACTION_MODEL,
          raw_extraction: payload as never,
          raw_extraction_saved_at: savedAt,
          status: "in_review",
          storage_path: storagePath,
          file_name: fileName,
          mime_type: file?.type ?? "text/plain",
          size_bytes: file?.size ?? null,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);

      await supabase.from("compliance_extraction_runs").insert({
        contract_id: contract.id,
        user_id: userId,
        model: EXTRACTION_MODEL,
        source_label: fileName,
        is_original: true,
        extraction: result as never,
      });

      setContractId(contract.id);
      setAiOriginal(result);
      setDraft(toReviewDraft(result));
      dirty.current = false;
      setStep("review");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that contract");
    } finally {
      setBusy(false);
    }
  };

  const editDraft = (updater: (d: ReviewDraft) => ReviewDraft) => {
    dirty.current = true;
    setDraft((d) => (d ? updater(d) : d));
  };

  const patchObligation = (index: number, patch: Partial<ReviewObligation>) => {
    editDraft((d) => ({
      ...d,
      obligations: d.obligations.map((o, i) => (i === index ? { ...o, ...patch } : o)),
    }));
  };

  const toggleRemoved = (index: number) => {
    editDraft((d) => ({
      ...d,
      obligations: d.obligations.map((o, i) => (i === index ? { ...o, removed: !o.removed } : o)),
    }));
  };

  const addObligation = () => {
    editDraft((d) => ({
      ...d,
      obligations: [
        ...d.obligations,
        {
          category: "administrative",
          title: "",
          description: "",
          due_date: null,
          recurrence: "one_time",
          priority: "medium",
          prior_approval_required: false,
          amount: null,
          source_quote: "Added manually",
          source_page: null,
          confidence: 1,
          ai_index: null,
          manual: true,
        },
      ],
    }));
  };

  const save = async () => {
    if (!draft || !contractId || !aiOriginal) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("compliance_contracts")
        .update({
          name: draft.name || "Untitled contract",
          funder: draft.funder ?? "",
          contract_number: draft.contract_number,
          award_amount: draft.award_amount,
          period_start: draft.period_start,
          period_end: draft.period_end,
          compensation_type: draft.compensation_type || "lump_sum",
          lump_sum_amount: draft.lump_sum_amount,
          reimbursable_cap: draft.reimbursable_cap,
          reimbursable_multiplier: draft.reimbursable_multiplier,
          invoicing_basis: draft.invoicing_basis,
          status: "active",
          raw_extraction: {
            model: EXTRACTION_MODEL,
            extracted_at: new Date().toISOString(),
            source_label: draft.name,
            extraction: aiOriginal,
            review_draft: draft,
            review_completed_at: new Date().toISOString(),
          } as never,
        })
        .eq("id", contractId);
      if (error) throw new Error(error.message);

      const inserts: Promise<unknown>[] = [];

      if (draft.obligations.length) {
        inserts.push(
          Promise.resolve(
            supabase.from("compliance_obligations").insert(
              draft.obligations.map((o, i) => {
                const original: ExtractedObligation | undefined =
                  o.ai_index === null ? undefined : aiOriginal.obligations[o.ai_index];
                const action = reviewActionFor(o, original);
                return {
                  contract_id: contractId,
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
                  confirmed: action !== "removed_by_user",
                  status: action === "removed_by_user" ? "removed" : "not_started",
                  sort_order: i,
                  extraction_source: original ? "ai" : "manual",
                  extraction_index: o.ai_index,
                  user_review_action: action,
                  original_ai_text: original?.description ?? null,
                  original_ai_due_date: original?.due_date ?? null,
                };
              }),
            ),
          ),
        );
      }
      if (draft.budget_categories.length) {
        inserts.push(
          Promise.resolve(
            supabase.from("compliance_budget_categories").insert(
              draft.budget_categories.map((b) => ({
                contract_id: contractId,
                user_id: userId,
                name: b.name,
                category_type: b.category_type || "direct",
                budgeted_amount: b.budgeted_amount ?? 0,
              })),
            ),
          ),
        );
      }
      if (draft.rate_cards.length) {
        inserts.push(
          Promise.resolve(
            supabase.from("compliance_rate_cards").insert(
              draft.rate_cards.map((r) => ({
                contract_id: contractId,
                user_id: userId,
                labor_category: r.labor_category,
                level: r.level,
                hourly_rate: r.hourly_rate,
              })),
            ),
          ),
        );
      }
      await Promise.all(inserts);

      const id = contractId;
      toast.success("Compliance tracker built from your contract.");
      onCreated();
      reset();
      onOpenChange(false);
      void navigate({ to: "/compliance/$id", params: { id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the contract");
    } finally {
      setSaving(false);
    }
  };

  const kept = draft?.obligations.filter((o) => !o.removed).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" ? "Upload a contract" : "Review what we found"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload"
              ? "PDF, DOCX, TXT or MD. We read the agreement and pull out every obligation, date and financial term."
              : "Your extraction is already saved — edits here are saved as you go. Removed items stay on the AI Extraction record."}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            <div className="flex gap-2">
              {(["file", "url", "text"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "secondary" : "ghost"}
                  onClick={() => setMode(m)}
                >
                  {m === "file" ? "Upload file" : m === "url" ? "From URL" : "Paste text"}
                </Button>
              ))}
            </div>

            {mode === "file" && (
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-8 text-center hover:border-primary">
                <FileUp className="size-6 text-primary" />
                <span className="text-sm font-medium text-foreground">
                  {file ? file.name : "Choose a contract file"}
                </span>
                <span className="text-xs text-muted-foreground">
                  PDF, DOCX, DOC, TXT or MD · up to 50 MB
                </span>
                <input
                  type="file"
                  accept={CONTRACT_UPLOAD_TYPES}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 50 * 1024 * 1024) {
                      toast.error("That file is larger than 50 MB.");
                      return;
                    }
                    setFile(f);
                  }}
                />
              </label>
            )}

            {mode === "url" && (
              <div className="space-y-2">
                <Label className="text-xs">Contract or solicitation URL</Label>
                <Input
                  placeholder="https://example.gov/award-terms"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Works with public web pages. For a PDF, download it and upload the file.
                </p>
              </div>
            )}

            {mode === "text" && (
              <div className="space-y-2">
                <Label className="text-xs">Paste the contract text</Label>
                <Textarea
                  rows={10}
                  placeholder="Paste the full agreement, terms and conditions, or award letter…"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
              </div>
            )}

            <Button
              variant="hero"
              className="w-full"
              disabled={!canExtract || busy}
              onClick={() => void handleExtract()}
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 size-4" />
              )}
              {busy ? "Reading the contract…" : "Extract obligations"}
            </Button>
          </div>
        )}

        {step === "review" && draft && (
          <div className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="Contract name">
                <Input
                  value={draft.name}
                  onChange={(e) => editDraft((d) => ({ ...d, name: e.target.value }))}
                />
              </Field>
              <Field label="Funder / client">
                <Input
                  value={draft.funder}
                  onChange={(e) => editDraft((d) => ({ ...d, funder: e.target.value }))}
                />
              </Field>
              <Field label="Compensation">
                <Select
                  value={draft.compensation_type}
                  onValueChange={(v) => editDraft((d) => ({ ...d, compensation_type: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPENSATION_TYPES.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Fee / award amount">
                <Input
                  type="number"
                  value={draft.lump_sum_amount ?? draft.award_amount ?? ""}
                  onChange={(e) =>
                    editDraft((d) => ({
                      ...d,
                      lump_sum_amount: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </Field>
              <Field label="Reimbursable cap">
                <Input
                  type="number"
                  value={draft.reimbursable_cap ?? ""}
                  onChange={(e) =>
                    editDraft((d) => ({
                      ...d,
                      reimbursable_cap: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </Field>
              <Field label="Reimbursable multiplier">
                <Input
                  type="number"
                  step="0.01"
                  value={draft.reimbursable_multiplier ?? ""}
                  onChange={(e) =>
                    editDraft((d) => ({
                      ...d,
                      reimbursable_multiplier: e.target.value ? Number(e.target.value) : null,
                    }))
                  }
                />
              </Field>
              <Field label="Period start">
                <Input
                  type="date"
                  value={draft.period_start ?? ""}
                  onChange={(e) =>
                    editDraft((d) => ({ ...d, period_start: e.target.value || null }))
                  }
                />
              </Field>
              <Field label="Period end">
                <Input
                  type="date"
                  value={draft.period_end ?? ""}
                  onChange={(e) => editDraft((d) => ({ ...d, period_end: e.target.value || null }))}
                />
              </Field>
            </section>

            {draft.invoicing_basis && (
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <strong className="text-foreground">Invoicing:</strong> {draft.invoicing_basis}
              </p>
            )}

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-foreground">
                  Obligations ({kept} of {draft.obligations.length} kept)
                </h3>
                <Button size="sm" variant="outline" onClick={addObligation}>
                  Add obligation
                </Button>
              </div>
              <div className="space-y-3">
                {draft.obligations.map((o, i) => (
                  <article
                    key={i}
                    className={
                      o.removed
                        ? "rounded-lg border border-dashed border-border p-3 opacity-60"
                        : "rounded-lg border border-border p-3"
                    }
                  >
                    <div className="flex gap-2">
                      <Input
                        value={o.title}
                        disabled={o.removed}
                        placeholder="Obligation title"
                        onChange={(e) => patchObligation(i, { title: e.target.value })}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={o.removed ? "Restore obligation" : "Remove obligation"}
                        onClick={() => toggleRemoved(i)}
                      >
                        {o.removed ? (
                          <RotateCcw className="size-4" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                    {!o.removed && (
                      <>
                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <Select
                            value={o.category}
                            onValueChange={(v) => patchObligation(i, { category: v })}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {OBLIGATION_CATEGORIES.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            type="date"
                            value={o.due_date ?? ""}
                            onChange={(e) =>
                              patchObligation(i, { due_date: e.target.value || null })
                            }
                          />
                          <Input
                            type="number"
                            placeholder="Amount"
                            value={o.amount ?? ""}
                            onChange={(e) =>
                              patchObligation(i, {
                                amount: e.target.value ? Number(e.target.value) : null,
                              })
                            }
                          />
                        </div>
                        <Textarea
                          className="mt-2"
                          rows={2}
                          value={o.description}
                          placeholder="Description"
                          onChange={(e) => patchObligation(i, { description: e.target.value })}
                        />
                      </>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="secondary">{CATEGORY_LABEL[o.category] ?? o.category}</Badge>
                      <Badge variant="outline">
                        {Math.round((o.confidence ?? 0) * 100)}% confidence
                      </Badge>
                      {o.source_page !== null && <Badge variant="outline">p. {o.source_page}</Badge>}
                      {o.prior_approval_required && (
                        <Badge variant="destructive">Prior approval</Badge>
                      )}
                      {o.removed && <Badge variant="outline">Removed from tracker</Badge>}
                    </div>
                    {o.source_quote && (
                      <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
                        “{o.source_quote}”
                      </blockquote>
                    )}
                  </article>
                ))}
                {!draft.obligations.length && (
                  <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No obligations detected. Add them manually.
                  </p>
                )}
              </div>
            </section>

            {draft.rate_cards.length > 0 && (
              <section>
                <h3 className="mb-2 text-sm font-bold text-foreground">
                  Hourly rates ({draft.rate_cards.length})
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {draft.rate_cards.map((r, i) => (
                    <Badge key={i} variant="secondary" className="text-[11px]">
                      {r.labor_category}
                      {r.level ? ` ${r.level}` : ""} · {money(r.hourly_rate)}/hr
                    </Badge>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {step === "review" && (
          <DialogFooter>
            <Button variant="ghost" onClick={() => close(false)}>
              Finish later
            </Button>
            <Button variant="hero" disabled={saving} onClick={() => void save()}>
              {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
              Build tracker
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
