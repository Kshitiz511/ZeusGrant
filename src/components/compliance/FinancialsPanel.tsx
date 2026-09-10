import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDate,
  money,
  percentCompleteFee,
  reimbursableTotal,
  type BudgetCategory,
  type ComplianceContract,
  type ComplianceInvoice,
  type ContractFinancials,
  type RateCard,
} from "@/lib/compliance";

export function FinancialsPanel({
  contract,
  budget,
  rates,
  invoices,
  fin,
  userId,
  canEdit,
  onChanged,
}: {
  contract: ComplianceContract;
  budget: BudgetCategory[];
  rates: RateCard[];
  invoices: ComplianceInvoice[];
  fin: ContractFinancials;
  userId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [percent, setPercent] = useState("");
  const [reimbCost, setReimbCost] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const suggestedFee = percentCompleteFee(contract, Number(percent || 0), fin.invoicedFees);
  const reimb = reimbursableTotal(Number(reimbCost || 0), contract.reimbursable_multiplier);
  const overCap =
    fin.reimbursableCap !== null && fin.reimbursablesBilled + reimb > fin.reimbursableCap;

  const addInvoice = async () => {
    if (!percent) {
      toast.error("Enter the percentage of work completed.");
      return;
    }
    const { error } = await supabase.from("compliance_invoices").insert({
      contract_id: contract.id,
      user_id: userId,
      percent_complete: Number(percent),
      fee_amount: suggestedFee,
      reimbursables_amount: reimb,
      period_end: periodEnd || null,
      status: "draft",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setPercent("");
    setReimbCost("");
    setPeriodEnd("");
    toast.success("Invoice recorded.");
    onChanged();
  };

  const setStatus = async (id: string, status: string) => {
    await supabase
      .from("compliance_invoices")
      .update({ status, paid_date: status === "paid" ? new Date().toISOString().slice(0, 10) : null })
      .eq("id", id);
    onChanged();
  };

  const removeInvoice = async (id: string) => {
    await supabase.from("compliance_invoices").delete().eq("id", id);
    onChanged();
  };

  const addBudgetLine = async () => {
    const name = window.prompt("Budget line name");
    if (!name) return;
    const amount = Number(window.prompt("Budgeted amount") ?? 0);
    const { error } = await supabase.from("compliance_budget_categories").insert({
      contract_id: contract.id,
      user_id: userId,
      name,
      budgeted_amount: Number.isFinite(amount) ? amount : 0,
    });
    if (error) toast.error(error.message);
    else onChanged();
  };

  const setSpent = async (line: BudgetCategory) => {
    const value = window.prompt(`Spent to date on ${line.name}`, String(line.spent_amount ?? 0));
    if (value === null) return;
    await supabase
      .from("compliance_budget_categories")
      .update({ spent_amount: Number(value) || 0 })
      .eq("id", line.id);
    onChanged();
  };

  if (!canEdit) {
    return (
      <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Budget and invoice tracking is available on Growth and above.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Contract value" value={money(fin.contractValue)} />
        <Stat label="Invoiced to date" value={money(fin.invoicedTotal)} />
        <Stat label="Paid" value={money(fin.paidTotal)} />
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-bold text-foreground">Percent complete billing</h3>
        <div className="mb-3">
          <Progress value={fin.percentComplete} />
          <p className="mt-1 text-xs text-muted-foreground">
            {fin.percentComplete}% of {money(fin.contractValue)} invoiced
            {contract.invoicing_basis ? ` · ${contract.invoicing_basis}` : ""}
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Period end">
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </Field>
          <Field label="% complete">
            <Input
              type="number"
              min={0}
              max={100}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
          <Field label="Reimbursable cost">
            <Input
              type="number"
              value={reimbCost}
              onChange={(e) => setReimbCost(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button className="w-full" variant="hero" onClick={() => void addInvoice()}>
              <Plus className="mr-2 size-4" /> Record
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Fee due this period: <strong className="text-foreground">{money(suggestedFee)}</strong> ·
          reimbursables at ×{Number(contract.reimbursable_multiplier ?? 1)}:{" "}
          <strong className="text-foreground">{money(reimb)}</strong>
          {fin.reimbursableCap !== null && (
            <>
              {" "}
              · cap {money(fin.reimbursableCap)}, remaining{" "}
              {money(Math.max(0, fin.reimbursablesRemaining ?? 0))}
            </>
          )}
        </p>
        {overCap && (
          <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
            This exceeds the reimbursable cap — written authorization is required first.
          </p>
        )}

        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>%</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>Reimbursables</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{formatDate(i.period_end)}</TableCell>
                <TableCell>{i.percent_complete}%</TableCell>
                <TableCell>{money(i.fee_amount)}</TableCell>
                <TableCell>{money(i.reimbursables_amount)}</TableCell>
                <TableCell>
                  <Badge variant={i.status === "paid" ? "secondary" : "outline"}>{i.status}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  {i.status !== "paid" && (
                    <Button size="sm" variant="ghost" onClick={() => void setStatus(i.id, "paid")}>
                      Mark paid
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete invoice"
                    onClick={() => void removeInvoice(i.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!invoices.length && (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  No invoices recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Budget lines</h3>
          <Button size="sm" variant="outline" onClick={() => void addBudgetLine()}>
            <Plus className="mr-2 size-4" /> Add line
          </Button>
        </div>
        <div className="space-y-3">
          {budget.map((b) => {
            const pct = Number(b.budgeted_amount)
              ? Math.round((Number(b.spent_amount) / Number(b.budgeted_amount)) * 100)
              : 0;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => void setSpent(b)}
                className="w-full text-left"
              >
                <div className="flex justify-between text-sm">
                  <span className="text-foreground">{b.name}</span>
                  <span className="text-muted-foreground">
                    {money(b.spent_amount)} / {money(b.budgeted_amount)}
                  </span>
                </div>
                <Progress className="mt-1" value={Math.min(100, pct)} />
              </button>
            );
          })}
          {!budget.length && (
            <p className="text-sm text-muted-foreground">
              No budget lines yet. The fee schedule above still tracks the contract total.
            </p>
          )}
        </div>
      </section>

      {rates.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-bold text-foreground">Hourly rate schedule</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Labor category</TableHead>
                <TableHead>Level</TableHead>
                <TableHead className="text-right">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.labor_category}</TableCell>
                  <TableCell>{r.level ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {Number(r.hourly_rate).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })}
                    /hr
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
    </div>
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
