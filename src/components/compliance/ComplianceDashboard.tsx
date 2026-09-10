import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CalendarClock, CheckCircle2, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CATEGORY_LABEL,
  formatDate,
  money,
  riskOf,
  summarize,
  type BudgetCategory,
  type ComplianceContract,
  type ComplianceInvoice,
  type ComplianceObligation,
  type ContractFinancials,
} from "@/lib/compliance";

const COLORS = ["#022eeb", "#7ac43d", "#f59e0b", "#ef4444", "#64748b"];

export function ComplianceDashboard({
  contract,
  obligations,
  budget,
  invoices,
  fin,
  showHealthScore,
  showBudget,
  onSelect,
  onOpenList,
}: {
  contract: ComplianceContract;
  obligations: ComplianceObligation[];
  budget: BudgetCategory[];
  invoices: ComplianceInvoice[];
  fin: ContractFinancials;
  showHealthScore: boolean;
  showBudget: boolean;
  onSelect?: ((o: ComplianceObligation) => void) | undefined;
  onOpenList?: (() => void) | undefined;
}) {
  const s = summarize(obligations);
  const upcoming = obligations
    .filter((o) => o.status !== "complete" && o.due_date)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 6);
  const risks = obligations.filter((o) => riskOf(o) === "overdue" || o.prior_approval_required);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          icon={<CheckCircle2 className="size-4 text-primary" />}
          label="Completion"
          value={`${s.completionRate}%`}
          hint={`${s.complete} of ${s.total} obligations`}
          onClick={onOpenList}
        />
        <Kpi
          icon={<AlertTriangle className="size-4 text-destructive" />}
          label="Overdue"
          value={String(s.overdue)}
          hint={`${s.dueSoon} due within 14 days`}
          onClick={onOpenList}
        />
        <Kpi
          icon={<CalendarClock className="size-4 text-primary" />}
          label="Invoiced"
          value={money(fin.invoicedTotal)}
          hint={`${fin.percentComplete}% of ${money(fin.contractValue)}`}
          onClick={onOpenList}
        />
        {showHealthScore ? (
          <Kpi
            icon={<ShieldCheck className="size-4 text-primary" />}
            label="Health score"
            value={String(s.healthScore)}
            hint="Completion minus overdue risk"
          />
        ) : (
          <Kpi
            icon={<ShieldCheck className="size-4 text-muted-foreground" />}
            label="Health score"
            value="—"
            hint="Professional and above"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Obligations by category">
          {s.byCategory.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={s.byCategory}
                  dataKey="total"
                  nameKey="label"
                  innerRadius={55}
                  outerRadius={90}
                >
                  {s.byCategory.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty />
          )}
        </Panel>

        <Panel title="Upcoming deadlines">
          <ul className="space-y-2">
            {upcoming.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(o)}
                  className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm transition hover:bg-muted"
                >
                <span className="min-w-0 truncate text-foreground">{o.title}</span>
                <Badge variant={riskOf(o) === "overdue" ? "destructive" : "secondary"}>
                  {formatDate(o.due_date)}
                </Badge>
                </button>
              </li>
            ))}
            {!upcoming.length && <Empty />}
          </ul>
        </Panel>

        {showBudget && (
          <Panel title="Budget utilization">
            {budget.length ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={budget.map((b) => ({
                  name: b.name,
                  Budgeted: Number(b.budgeted_amount ?? 0),
                  Spent: Number(b.spent_amount ?? 0),
                }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="Budgeted" fill="#022eeb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Spent" fill="#7ac43d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="text-muted-foreground">Fee invoiced</span>
                    <span className="font-semibold text-foreground">
                      {money(fin.invoicedFees)} / {money(fin.contractValue)}
                    </span>
                  </div>
                  <Progress value={fin.percentComplete} />
                </div>
                {fin.reimbursableCap !== null && (
                  <div>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="text-muted-foreground">Reimbursables</span>
                      <span className="font-semibold text-foreground">
                        {money(fin.reimbursablesBilled)} / {money(fin.reimbursableCap)}
                      </span>
                    </div>
                    <Progress
                      value={Math.min(
                        100,
                        (fin.reimbursablesBilled / (fin.reimbursableCap || 1)) * 100,
                      )}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {invoices.length} invoice{invoices.length === 1 ? "" : "s"} ·{" "}
                  {money(fin.paidTotal)} paid ·{" "}
                  {contract.invoicing_basis ?? "monthly percent complete"}
                </p>
              </div>
            )}
          </Panel>
        )}

        <Panel title="Risk flags">
          <ul className="space-y-2">
            {risks.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(o)}
                  className="flex w-full items-start gap-2 rounded-md px-1 py-1 text-left text-sm transition hover:bg-muted"
                >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-yellow-600" />
                <span className="text-foreground">
                  {o.title}
                  <span className="text-muted-foreground">
                    {" "}
                    — {riskOf(o) === "overdue" ? "overdue" : "requires prior approval"} (
                    {CATEGORY_LABEL[o.category] ?? o.category})
                  </span>
                </span>
                </button>
              </li>
            ))}
            {!risks.length && (
              <p className="text-sm text-muted-foreground">No risks flagged right now.</p>
            )}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  onClick?: (() => void) | undefined;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`w-full rounded-xl border border-border bg-card p-4 text-left ${
        onClick ? "transition hover:border-primary hover:shadow-soft" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {onClick && <p className="mt-2 text-[11px] font-semibold text-primary">View tasks →</p>}
    </Tag>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>;
}
