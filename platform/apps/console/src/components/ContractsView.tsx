import { useState } from "react";
import { Building2, FileText, Gauge, Loader2, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/ui/modal";
import { useContracts, useCreateContract, useModuleAccess } from "@/lib/hooks";
import type { Contract } from "@/lib/types";

const SAMPLE =
  "The Vendor shall deliver the quarterly compliance report by March 31, 2026. Customer must pay invoice #204 within 30 days of receipt. Vendor shall maintain SOC 2 certification throughout the term.";

export function ContractsView({ onOpen }: { onOpen: (c: Contract) => void }) {
  const { data: contracts, isLoading, error } = useContracts();
  const create = useCreateContract();
  const { limits } = useModuleAccess("contract_compliance");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [body, setBody] = useState("");

  const max = typeof limits?.contracts_max === "number" ? (limits.contracts_max as number) : null;
  const count = contracts?.length ?? 0;
  const atLimit = max !== null && count >= max;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate(
      { title, counterparty: counterparty || undefined, body },
      {
        onSuccess: () => {
          setTitle("");
          setCounterparty("");
          setBody("");
          setUploadOpen(false);
        },
      },
    );
  };

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={FileText}
          label="Contracts"
          value={isLoading ? "—" : String(count)}
          hint={max !== null ? `of ${max} on your plan` : "tracked in this workspace"}
        />
        <StatCard
          icon={Building2}
          label="Counterparties"
          value={isLoading ? "—" : String(new Set((contracts ?? []).map((c) => c.counterparty).filter(Boolean)).size)}
          hint="unique organizations"
        />
        <StatCard
          icon={Gauge}
          label="Plan capacity"
          value={isLoading || max === null ? "—" : `${Math.round((count / max) * 100)}%`}
          hint={max !== null ? `${Math.max(max - count, 0)} slots remaining` : "unlimited"}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {count} contract{count === 1 ? "" : "s"}
          {max !== null && ` of ${max} available on your plan`}
        </p>
        <div className="flex items-center gap-2">
          {count > 0 && (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="size-3.5" /> AI-tracked
            </Badge>
          )}
          <Button
            variant="hero"
            size="sm"
            disabled={atLimit}
            onClick={() => setUploadOpen(true)}
            title={atLimit ? "Upgrade to track more contracts" : undefined}
          >
            <Plus className="mr-2 size-4" /> Upload contract
          </Button>
        </div>
      </div>

      {atLimit && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
          <span>You&apos;ve reached the contract limit on your plan.</span>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : count === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <h2 className="text-lg font-bold text-foreground">No contracts yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Upload an award agreement, grant contract or scope of services. We pull out every
            obligation, deadline and financial term — with the exact contract language behind each
            one — so you can confirm it before the tracker is built.
          </p>
          <Button className="mt-5" variant="hero" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-2 size-4" /> Upload contract
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {contracts!.map((c) => (
            <button
              key={c.id}
              onClick={() => onOpen(c)}
              className="rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary"
            >
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-foreground">{c.title}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.counterparty || "No counterparty recorded"}
                  </p>
                </div>
              </div>
              <p className="mt-4 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                {c.body || "No contract text."}
              </p>
              <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-primary">
                <Sparkles className="size-3.5" /> Open to analyze
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload contract"
        description="Paste the contract text. AI extraction of obligations runs on demand from the detail view."
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="MSA with Acme" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Counterparty</label>
              <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Acme Corp" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Contract text</label>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setBody(SAMPLE)}>
                Use sample
              </button>
            </div>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} required rows={7} placeholder="Paste the contract body…" />
          </div>

          {create.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {(create.error as Error).message}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="hero" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Plus className="mr-2 size-4" />}
              Create contract
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-lift">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-2 text-2xl font-extrabold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
