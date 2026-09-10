import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Download, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AIExtractionTab } from "@/components/compliance/AIExtractionTab";
import { AuditVaultTab } from "@/components/audit/AuditVaultTab";
import { ComplianceDashboard } from "@/components/compliance/ComplianceDashboard";
import { ComplianceTimeline } from "@/components/compliance/ComplianceTimeline";
import { ContractSettings } from "@/components/compliance/ContractSettings";
import { FinancialsPanel } from "@/components/compliance/FinancialsPanel";
import { HealthGauge } from "@/components/compliance/HealthGauge";
import { ObligationBoard } from "@/components/compliance/ObligationBoard";
import { ObligationPanel } from "@/components/compliance/ObligationPanel";
import { TaskListView } from "@/components/compliance/TaskListView";
import { TeamPanel } from "@/components/compliance/TeamPanel";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useModules } from "@/hooks/useModules";
import { useContract } from "@/hooks/useCompliance";
import { supabase } from "@/integrations/supabase/client";
import {
  CATEGORY_LABEL,
  CONTRACT_TYPE_LABEL,
  STATUS_LABEL,
  complianceCapabilities,
  financials,
  formatDate,
  healthScoreOf,
  money,
  summarize,
  type ComplianceObligation,
} from "@/lib/compliance";
import { downloadFile, printHtml, toCsv } from "@/lib/tracker";

export const Route = createFileRoute("/_authenticated/compliance/$id")({
  head: () => ({
    meta: [
      { title: "Contract compliance | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Track every obligation, deadline, deliverable and dollar on a single award contract.",
      },
      { property: "og:title", content: "Contract compliance | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Obligation board, timeline, budget and invoicing for one contract.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ContractPage,
});

function ContractPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const { limits, compliancePlanId, isTrialing } = useEntitlements(user?.id);
  const { hasModule } = useModules(user?.id);
  const caps = complianceCapabilities(compliancePlanId, isTrialing);
  const {
    contract,
    obligations,
    allObligations,
    budget,
    rates,
    invoices,
    documents,
    loading,
    refetch,
    updateObligation,
    updateContract,
  } = useContract(id, user?.id);

  const [selected, setSelected] = useState<ComplianceObligation | null>(null);
  const [orgName, setOrgName] = useState("");
  const [tab, setTab] = useState("board");

  const fin = useMemo(
    () => (contract ? financials(contract, budget, invoices) : null),
    [contract, budget, invoices],
  );

  if (loading) {
    return (
      <AppShell title="Contract">
        <Loader2 className="size-5 animate-spin text-primary" />
      </AppShell>
    );
  }

  if (!contract || !fin) {
    return (
      <AppShell title="Contract not found">
        <Button variant="outline" asChild>
          <Link to="/compliance">
            <ArrowLeft className="mr-2 size-4" /> Back to Compliance Tracker
          </Link>
        </Button>
      </AppShell>
    );
  }

  const s = summarize(obligations);

  const changeStatus = (o: ComplianceObligation, status: string) => {
    void updateObligation(o.id, {
      status,
      completed_at: status === "complete" ? new Date().toISOString() : null,
    }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not update"));
  };

  const exportCsv = () => {
    downloadFile(
      toCsv(
        obligations.map((o) => ({
          title: o.title,
          category: CATEGORY_LABEL[o.category] ?? o.category,
          status: STATUS_LABEL[o.status] ?? o.status,
          due_date: o.due_date,
          recurrence: o.recurrence,
          assignee: o.assignee_name,
          prior_approval: o.prior_approval_required ? "yes" : "no",
          source_quote: o.source_quote,
        })),
      ),
      `${contract.name.replace(/\W+/g, "-").toLowerCase()}-obligations.csv`,
      "text/csv",
    );
  };

  const exportPdf = () => {
    const header = caps.whiteLabelReport && orgName ? orgName : "ZCS GrantMatch Innovation";
    printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${contract.name} — compliance status</title>
<style>body{font-family:system-ui,sans-serif;padding:32px;color:#111}h1{font-size:20px;margin:0 0 4px}
h2{font-size:14px;margin:24px 0 8px}table{width:100%;border-collapse:collapse;font-size:12px}
td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}small{color:#666}</style></head><body>
<small>${header}</small><h1>${contract.name}</h1>
<small>${contract.funder} · ${formatDate(contract.period_start)} – ${formatDate(contract.period_end)}</small>
<h2>Status</h2><p>${s.complete} of ${s.total} obligations complete (${s.completionRate}%). ${s.overdue} overdue, ${s.dueSoon} due within 14 days.</p>
<h2>Financials</h2><p>Contract value ${money(fin.contractValue)} · invoiced ${money(fin.invoicedTotal)} · paid ${money(fin.paidTotal)}${fin.reimbursableCap !== null ? ` · reimbursables ${money(fin.reimbursablesBilled)} of ${money(fin.reimbursableCap)}` : ""}.</p>
<h2>Obligations</h2><table><tr><th>Title</th><th>Category</th><th>Due</th><th>Status</th></tr>
${obligations
  .map(
    (o) =>
      `<tr><td>${o.title}</td><td>${CATEGORY_LABEL[o.category] ?? o.category}</td><td>${formatDate(o.due_date)}</td><td>${STATUS_LABEL[o.status] ?? o.status}</td></tr>`,
  )
  .join("")}
</table></body></html>`);
  };

  const openDocument = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("Could not open that file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <AppShell title={contract.name} {...(contract.funder ? { description: contract.funder } : {})}>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/compliance">
            <ArrowLeft className="mr-2 size-4" /> All contracts
          </Link>
        </Button>
        <Badge variant="secondary">{money(contract.lump_sum_amount ?? contract.award_amount)}</Badge>
        <Badge variant="outline">{contract.compensation_type.replace(/_/g, " ")}</Badge>
        {s.overdue > 0 && <Badge variant="destructive">{s.overdue} overdue</Badge>}
        <div className="ml-auto flex items-center gap-2">
          {caps.whiteLabelReport && (
            <input
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Your firm name"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          )}
          <Button size="sm" variant="outline" disabled={!caps.csvExport} onClick={exportCsv}>
            <Download className="mr-2 size-4" /> CSV
          </Button>
          <Button size="sm" variant="outline" disabled={!caps.pdfReport} onClick={exportPdf}>
            <FileDown className="mr-2 size-4" /> PDF report
          </Button>
        </div>
      </div>

      {contract.extraction_summary && (
        <p className="mb-6 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {contract.extraction_summary}
        </p>
      )}

      <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Total tasks" value={String(s.total)} hint={CONTRACT_TYPE_LABEL[contract.contract_type] ?? "Contract"} />
          <Kpi label="Completed" value={`${s.complete} (${s.completionRate}%)`} hint="Closed obligations" />
          <Kpi label="Overdue" value={String(s.overdue)} tone={s.overdue > 0 ? "bad" : "good"} hint="Past due, not closed" />
          <Kpi label="Due in 30 days" value={String(s.upcoming30)} hint="Upcoming deadlines" />
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <HealthGauge score={healthScoreOf(obligations)} />
        </div>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="board">Task board</TabsTrigger>
          <TabsTrigger value="list">Task list</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="extraction">AI extraction</TabsTrigger>
          <TabsTrigger value="vault">Evidence vault</TabsTrigger>

          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>


        <TabsContent value="board" className="mt-6">
          <ObligationBoard
            obligations={obligations}
            evidence={documents}
            onStatusChange={changeStatus}
            onSelect={setSelected}
          />
        </TabsContent>

        <TabsContent value="list" className="mt-6">
          <TaskListView
            obligations={obligations}
            evidence={documents}
            onSelect={setSelected}
            onBulkStatus={(ids, status) => {
              ids.forEach((tid) => {
                const o = obligations.find((x) => x.id === tid);
                if (o) changeStatus(o, status);
              });
            }}
            onExportCsv={exportCsv}
            canExport={caps.csvExport}
          />
        </TabsContent>


        <TabsContent value="timeline" className="mt-6">
          <ComplianceTimeline obligations={obligations} enabled={caps.timelineView} />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-6">
          <ComplianceDashboard
            contract={contract}
            obligations={obligations}
            budget={budget}
            invoices={invoices}
            fin={fin}
            showHealthScore={caps.healthScore}
            showBudget={caps.budgetTracking}
            onSelect={setSelected}
            onOpenList={() => setTab("list")}
          />
        </TabsContent>

        <TabsContent value="extraction" className="mt-6">
          {user?.id && (
            <AIExtractionTab
              contract={contract}
              obligations={allObligations}
              userId={user.id}
              onChanged={() => void refetch()}
            />
          )}
        </TabsContent>

        <TabsContent value="vault" className="mt-6">
          {!hasModule("audit_compliance") ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <p className="text-sm font-semibold text-foreground">
                Audit Compliance &amp; Documentation Vault
              </p>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                Store timestamped, hashed evidence against every obligation and generate formal
                compliance packages for auditors and contracting agencies.
              </p>
              <Button className="mt-4" asChild>
                <Link to="/modules/$slug" params={{ slug: "audit-compliance" }}>
                  See what's included
                </Link>
              </Button>
            </div>
          ) : (
            user?.id && (
              <AuditVaultTab
                contract={contract}
                obligations={obligations}
                userId={user.id}
                uploaderName={user.email ?? "Account owner"}
                enterprise={compliancePlanId === "agency"}
              />
            )
          )}
        </TabsContent>



        <TabsContent value="financials" className="mt-6">

          {user?.id && (
            <FinancialsPanel
              contract={contract}
              budget={budget}
              rates={rates}
              invoices={invoices}
              fin={fin}
              userId={user.id}
              canEdit={caps.budgetTracking}
              onChanged={() => void refetch()}
            />
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <div className="space-y-2">
            {contract.storage_path && (
              <DocRow
                name={`${contract.file_name ?? "Contract"} (source contract)`}
                onOpen={() => void openDocument(contract.storage_path!)}
              />
            )}
            {documents.map((d) => (
              <DocRow key={d.id} name={d.name} onOpen={() => void openDocument(d.storage_path)} />
            ))}
            {!documents.length && !contract.storage_path && (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="team" className="mt-6">
          {user?.id && (
            <TeamPanel contractId={contract.id} userId={user.id} enabled={caps.teamAssignment} />
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-6">
          <ContractSettings contract={contract} onSave={updateContract} />
        </TabsContent>
      </Tabs>

      {user?.id && (
        <ObligationPanel
          obligation={selected}
          userId={user.id}
          contractId={contract.id}
          canAssign={caps.teamAssignment}
          evidence={documents}
          onClose={() => setSelected(null)}
          onSave={updateObligation}
          onDocumentAdded={() => void refetch()}
        />
      )}
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={
          tone === "bad"
            ? "mt-1 text-2xl font-extrabold text-destructive"
            : "mt-1 text-2xl font-extrabold text-foreground"
        }
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DocRow({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
      <span className="truncate text-sm text-foreground">{name}</span>
      <Button size="sm" variant="ghost" onClick={onOpen}>
        <Download className="mr-2 size-4" /> Open
      </Button>
    </div>
  );
}
