import { useState } from "react";
import { ArrowLeft, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { DocumentPanel } from "@/components/DocumentPanel";
import { ObligationRow } from "@/components/ObligationRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAnalyze,
  useCreateObligation,
  useDeleteContract,
  useDeleteObligation,
  useObligations,
  useUpdateObligation,
} from "@/lib/hooks";
import type { Contract, Priority } from "@/lib/types";

export function ContractDetail({
  contract,
  onBack,
}: {
  contract: Contract;
  onBack: () => void;
}) {
  const { data: obligations, isLoading } = useObligations(contract.id);
  const analyze = useAnalyze(contract.id);
  const update = useUpdateObligation(contract.id);
  const remove = useDeleteObligation(contract.id);
  const deleteContract = useDeleteContract();
  const [adding, setAdding] = useState(false);

  const rows = obligations ?? [];
  const total = rows.length;
  const complete = rows.filter((o) => o.status === "done").length;
  const completionRate = total > 0 ? Math.round((complete / total) * 100) : 0;
  const hasObligations = total > 0;
  // Analysis needs source text; without it the button would only ever 422.
  const canAnalyze = !!contract.body?.trim();
  const busy = update.isPending || remove.isPending;
  const error = (analyze.error ?? update.error ?? remove.error) as Error | null;

  return (
    <>
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-4 -ml-2">
        <ArrowLeft className="mr-2 size-4" /> Back to contracts
      </Button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-extrabold text-foreground">{contract.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {contract.counterparty || "No counterparty recorded"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="hero"
            onClick={() => analyze.mutate()}
            disabled={analyze.isPending || !canAnalyze}
            title={canAnalyze ? undefined : "Upload a document or add contract text first"}
          >
            {analyze.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 size-4" />
            )}
            {analyze.isPending
              ? "Analyzing…"
              : hasObligations
                ? "Re-analyze"
                : "Analyze with AI"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Delete contract"
            disabled={deleteContract.isPending}
            onClick={() => {
              // Destructive and cascading (obligations + documents), so it is
              // explicitly confirmed rather than undoable.
              if (
                window.confirm(
                  `Delete "${contract.title}"? Its obligations and documents will be removed permanently.`,
                )
              ) {
                deleteContract.mutate(contract.id, { onSuccess: onBack });
              }
            }}
          >
            <Trash2 className="size-4 text-destructive" />
          </Button>
        </div>
      </div>

      {hasObligations && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>
              {complete}/{total} obligations complete
            </span>
            <span className="font-semibold text-foreground">{completionRate}%</span>
          </div>
          <Progress value={completionRate} />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-2">
          <DocumentPanel contractId={contract.id} />

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="mb-1 font-bold text-foreground">Contract text</h3>
            <p className="mb-4 text-sm text-muted-foreground">
              {contract.body_source === "document"
                ? "Extracted from the uploaded document."
                : "The source used for extraction."}
            </p>
            <p className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {contract.body || "No text yet. Upload a document to get started."}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
            <div>
              <h3 className="font-bold text-foreground">Obligations</h3>
              <p className="text-sm text-muted-foreground">
                Extracted by AI — review before relying on them.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
              <Plus className="mr-1.5 size-4" /> Add
            </Button>
          </div>

          {adding && (
            <AddObligationForm contractId={contract.id} onDone={() => setAdding(false)} />
          )}

          {isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !hasObligations ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {canAnalyze ? (
                <>
                  No obligations yet. Click{" "}
                  <span className="font-semibold text-foreground">Analyze with AI</span> to
                  extract them.
                </>
              ) : (
                "Upload a contract document to get started."
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((o) => (
                <ObligationRow
                  key={o.id}
                  obligation={o}
                  busy={busy}
                  onStatusChange={(status) => update.mutate({ id: o.id, input: { status } })}
                  onDelete={() => remove.mutate(o.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function AddObligationForm({
  contractId,
  onDone,
}: {
  contractId: string;
  onDone: () => void;
}) {
  const create = useCreateObligation(contractId);
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [responsible, setResponsible] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    create.mutate(
      {
        description: description.trim(),
        // Empty inputs mean "not set", not an empty string.
        due_date: dueDate || null,
        responsible: responsible.trim() || null,
        priority,
      },
      {
        onSuccess: () => {
          setDescription("");
          setDueDate("");
          setResponsible("");
          onDone();
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-3 border-b border-border bg-muted/30 p-5">
      <Input
        autoFocus
        required
        maxLength={2000}
        placeholder="What has to happen?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          type="date"
          aria-label="Due date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <Input
          placeholder="Responsible"
          maxLength={200}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
        />
        <select
          aria-label="Priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground"
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </div>

      {create.error && (
        <p className="text-sm text-destructive">{(create.error as Error).message}</p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
          Add obligation
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
