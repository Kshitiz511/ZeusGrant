import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, FileText, Loader2, Plus, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ContractUploadDialog } from "@/components/compliance/ContractUploadDialog";
import { AddOnStore } from "@/components/app/AddOnStore";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useContractSlots } from "@/hooks/useContractSlots";
import { useAllObligations, useContracts } from "@/hooks/useCompliance";
import {
  complianceCapabilities,
  type ComplianceContract,
  formatDate,
  isActionable,
  money,
  summarize,
} from "@/lib/compliance";

export const Route = createFileRoute("/_authenticated/compliance/")({
  head: () => ({
    meta: [
      { title: "Compliance Tracker | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Upload an award contract and turn it into a live compliance tracker: obligations, deadlines, budgets, invoices and a health score.",
      },
      { property: "og:title", content: "Compliance Tracker | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Every reporting, financial and deliverable obligation from your award, tracked.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const { user } = useAuth();
  const { limits, compliancePlanId, isTrialing, hasAccess, loading: entLoading } = useEntitlements(user?.id);
  const { contracts, loading, refetch } = useContracts(user?.id);
  const { obligations } = useAllObligations(user?.id);
  const { extraSlots, refetch: refetchSlots } = useContractSlots(user?.id);
  const caps = complianceCapabilities(compliancePlanId, isTrialing);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resume, setResume] = useState<ComplianceContract | null>(null);
  const [buySlotsOpen, setBuySlotsOpen] = useState(false);

  const pendingReview = contracts.filter((c) => c.status === "in_review" && c.raw_extraction);

  const contractsMax = caps.contractsMax === null ? null : caps.contractsMax + extraSlots;
  const atLimit = contractsMax !== null && contracts.length >= contractsMax;

  const alerts = obligations.filter(isActionable);
  const orgScore = summarize(obligations);

  if (entLoading || loading) {
    return (
      <AppShell title="Compliance Tracker">
        <Loader2 className="size-5 animate-spin text-primary" />
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell title="Compliance Tracker" description="Stay on top of every award requirement.">
        <SubscriptionGate loading={false} hasAccess={false} feature="The Compliance Tracker">
          <div />
        </SubscriptionGate>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Compliance Tracker"
      description="Upload a contract and we build the obligation, deadline and budget tracker for you."
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {contracts.length} contract{contracts.length === 1 ? "" : "s"}
          {contractsMax !== null &&
            ` of ${contractsMax} available${extraSlots > 0 ? ` (${extraSlots} purchased)` : " on your plan"}`}
        </p>
        <div className="flex items-center gap-2">
          {caps.healthScore && obligations.length > 0 && (
            <Badge variant="secondary" className="gap-1">
              <ShieldCheck className="size-3.5" /> Health {orgScore.healthScore}
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
          <span>
            You&apos;ve reached the contract limit on your plan. Buy additional contract uploads or{" "}
            <Link
              to="/billing"
              search={{ plan: undefined, annual: false, checkout: undefined }}
              className="font-semibold underline"
            >
              upgrade
            </Link>
            .
          </span>
          <Button size="sm" variant="hero" className="ml-auto" onClick={() => setBuySlotsOpen(true)}>
            Buy more contracts
          </Button>
        </div>
      )}

      {pendingReview.length > 0 && (
        <div className="mb-6 space-y-2">
          {pendingReview.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
            >
              <span className="text-foreground">
                <strong>{c.name}</strong> — extraction saved, review not finished. Nothing was lost.
              </span>
              <Button
                size="sm"
                variant="hero"
                className="ml-auto"
                onClick={() => {
                  setResume(c);
                  setUploadOpen(true);
                }}
              >
                Resume review
              </Button>
            </div>
          ))}
        </div>
      )}

      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.slice(0, 5).map((o) => (
            <div
              key={o.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm"
            >
              <AlertTriangle className="size-4 shrink-0 text-yellow-600" />
              <span className="text-foreground">
                {o.title} — due {formatDate(o.due_date)}
              </span>
              <Button size="sm" variant="outline" className="ml-auto" asChild>
                <Link to="/compliance/$id" params={{ id: o.contract_id }}>
                  Open
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {contracts
          .filter((c) => c.status !== "in_review")
          .map((c) => {
          const rows = obligations.filter((o) => o.contract_id === c.id);
          const s = summarize(rows);
          return (
            <Link
              key={c.id}
              to="/compliance/$id"
              params={{ id: c.id }}
              className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary"
            >
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <h2 className="truncate font-bold text-foreground">{c.name}</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {c.funder || "No funder recorded"}
                  </p>
                </div>
                <Badge variant="secondary" className="ml-auto">
                  {money(c.lump_sum_amount ?? c.award_amount)}
                </Badge>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>
                    {s.complete}/{s.total} obligations complete
                  </span>
                  {s.overdue > 0 && (
                    <span className="font-semibold text-destructive">{s.overdue} overdue</span>
                  )}
                </div>
                <Progress value={s.completionRate} />
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Period {formatDate(c.period_start)} – {formatDate(c.period_end)}
              </p>
            </Link>
          );
        })}
      </div>

      {!contracts.length && (
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
      )}

      <Dialog
        open={buySlotsOpen}
        onOpenChange={(o) => {
          setBuySlotsOpen(o);
          if (!o) void refetchSlots();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add more contract uploads</DialogTitle>
            <DialogDescription>
              One-time purchase. Extra contract slots are permanent and stack with your plan
              allowance.
            </DialogDescription>
          </DialogHeader>
          <AddOnStore contractsOnly />
        </DialogContent>
      </Dialog>

      {user?.id && (
        <ContractUploadDialog
          open={uploadOpen}
          resume={resume}
          onOpenChange={(v) => {
            setUploadOpen(v);
            if (!v) setResume(null);
          }}
          userId={user.id}
          onCreated={() => void refetch()}
        />
      )}
    </AppShell>
  );
}
