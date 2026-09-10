import { ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalyze, useObligations } from "@/lib/hooks";
import { formatDate, priorityVariant } from "@/lib/format";
import type { Contract } from "@/lib/types";

export function ContractDetail({ contract, onBack }: { contract: Contract; onBack: () => void }) {
  const { data: obligations, isLoading } = useObligations(contract.id);
  const analyze = useAnalyze(contract.id);

  const rows = obligations ?? [];
  const total = rows.length;
  const complete = rows.filter((o) => o.status !== "open").length;
  const completionRate = total > 0 ? Math.round((complete / total) * 100) : 0;
  const hasObligations = total > 0;

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
        <Button variant="hero" onClick={() => analyze.mutate()} disabled={analyze.isPending}>
          {analyze.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}
          {analyze.isPending ? "Analyzing…" : hasObligations ? "Re-analyze" : "Analyze with AI"}
        </Button>
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

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h3 className="mb-1 font-bold text-foreground">Contract text</h3>
          <p className="mb-4 text-sm text-muted-foreground">The source used for extraction.</p>
          <p className="max-h-96 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {contract.body || "No body text."}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card lg:col-span-3">
          <div className="border-b border-border p-5">
            <h3 className="font-bold text-foreground">Obligations</h3>
            <p className="text-sm text-muted-foreground">Extracted by AI — review before relying on them.</p>
          </div>

          {analyze.error && (
            <div className="m-5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(analyze.error as Error).message}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-2 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !hasObligations ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No obligations yet. Click{" "}
              <span className="font-semibold text-foreground">Analyze with AI</span> to extract them.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((o) => (
                <li key={o.id} className="flex flex-wrap items-start gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground">{o.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {o.responsible ? `${o.responsible} · ` : ""}
                      Due {formatDate(o.due_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {o.source === "ai" && <Badge variant="secondary">AI</Badge>}
                    <Badge variant={priorityVariant(o.priority)} className="capitalize">
                      {o.priority}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
