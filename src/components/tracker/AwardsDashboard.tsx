import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FileDown, Lock } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FUNDER_TYPES,
  STAGES,
  STAGE_LABEL,
  awardsSummary,
  compactMoney,
  formatMoney,
  lastTwelveMonths,
  printHtml,
  recordValue,
  type GrantRecord,
} from "@/lib/tracker";


const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5e9",
  "#ef4444",
];

export function AwardsDashboard({
  records,
  canExportPdf,
  whiteLabel,
  orgName,
}: {
  records: GrantRecord[];
  canExportPdf: boolean;
  whiteLabel: boolean;
  orgName: string;
}) {
  const [range, setRange] = useState("year");
  const [funderType, setFunderType] = useState("all");
  const [focusArea, setFocusArea] = useState("all");
  const [clientName, setClientName] = useState("");
  const [drill, setDrill] = useState<{ title: string; rows: GrantRecord[] } | null>(null);
  const openDrill = (title: string, rows: GrantRecord[]) => setDrill({ title, rows });



  const focusAreas = useMemo(
    () => Array.from(new Set(records.flatMap((r) => r.focus_areas))).sort(),
    [records],
  );

  const filtered = useMemo(() => {
    const now = new Date();
    const startOf = (() => {
      if (range === "month") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      if (range === "quarter")
        return new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
      if (range === "year") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return null;
    })();
    return records.filter((r) => {
      if (funderType !== "all" && r.funder_type !== funderType) return false;
      if (focusArea !== "all" && !r.focus_areas.includes(focusArea)) return false;
      if (startOf) {
        const ref = r.submission_date ?? r.created_at.slice(0, 10);
        if (ref < startOf.toISOString().slice(0, 10)) return false;
      }
      return true;
    });
  }, [records, range, funderType, focusArea]);

  const summary = awardsSummary(filtered);

  const byStage = STAGES.map((s) => {
    const rows = filtered.filter((r) => r.stage === s.id);
    return { stage: s.label, value: rows.reduce((n, r) => n + recordValue(r), 0), count: rows.length };
  }).filter((s) => s.count > 0);

  const awardsByType = FUNDER_TYPES.map((t) => ({
    name: t,
    value: filtered
      .filter((r) => r.stage === "awarded" && r.funder_type === t)
      .reduce((n, r) => n + Number(r.awarded_amount ?? 0), 0),
  })).filter((d) => d.value > 0);

  const monthly = lastTwelveMonths().map((m) => ({
    month: m.slice(5),
    submissions: filtered.filter((r) => (r.submission_date ?? "").startsWith(m)).length,
  }));

  const winRateByType = FUNDER_TYPES.map((t) => {
    const decided = filtered.filter(
      (r) => r.funder_type === t && (r.stage === "awarded" || r.stage === "declined"),
    );
    const won = decided.filter((r) => r.stage === "awarded").length;
    return { name: t, winRate: decided.length ? Math.round((won / decided.length) * 100) : 0, decided: decided.length };
  }).filter((d) => d.decided > 0);

  const awardedVsRequested = filtered
    .filter((r) => r.stage === "awarded")
    .map((r) => ({
      name: r.grant_name.slice(0, 18),
      requested: Number(r.requested_amount ?? 0),
      awarded: Number(r.awarded_amount ?? 0),
    }));

  const fundingByFocus = focusAreas
    .map((area) => ({
      name: area,
      value: filtered
        .filter((r) => r.stage === "awarded" && r.focus_areas.includes(area))
        .reduce((n, r) => n + Number(r.awarded_amount ?? 0), 0),
    }))
    .filter((d) => d.value > 0);

  const thisYear = new Date().getUTCFullYear();
  const yoy = [thisYear - 1, thisYear].map((y) => {
    const rows = records.filter((r) => (r.submission_date ?? r.created_at).startsWith(String(y)));
    return {
      year: String(y),
      submissions: rows.length,
      awards: rows.filter((r) => r.stage === "awarded").length,
      funding: rows.reduce((n, r) => n + Number(r.awarded_amount ?? 0), 0),
    };
  });

  const exportPdf = () => {
    if (!canExportPdf) {
      toast.error("The Awards Dashboard PDF report is available on Professional and above.");
      return;
    }
    const brand = whiteLabel ? clientName || orgName : `${orgName} · Prepared with GrantMatch AI`;
    const rows = filtered
      .map(
        (r) =>
          `<tr><td>${r.grant_name}</td><td>${r.funder}</td><td>${r.stage}</td><td>${formatMoney(
            r.requested_amount,
          )}</td><td>${formatMoney(r.awarded_amount)}</td></tr>`,
      )
      .join("");
    printHtml(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Awards Report</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px}
      h1{font-size:20pt;margin-bottom:2pt}h2{font-size:13pt;margin-top:22pt}
      table{width:100%;border-collapse:collapse;font-size:10pt;margin-top:8pt}
      th,td{border:1px solid #ddd;padding:6px;text-align:left}
      .kpis{display:flex;gap:16px;margin-top:14pt}.kpi{border:1px solid #ddd;padding:10px;flex:1}
      .kpi b{display:block;font-size:16pt}</style></head><body>
      <h1>Grant Awards Report</h1><p>${brand} — ${new Date().toLocaleDateString()}</p>
      <div class="kpis">
        <div class="kpi"><b>${summary.submittedCount}</b>Submitted (${compactMoney(summary.submittedValue)})</div>
        <div class="kpi"><b>${summary.awardedCount}</b>Awarded (${compactMoney(summary.awardedValue)})</div>
        <div class="kpi"><b>${summary.winRate === null ? "—" : `${summary.winRate}%`}</b>Win rate</div>
        <div class="kpi"><b>${compactMoney(summary.pipelineValue)}</b>In pipeline</div>
      </div>
      <h2>Grant portfolio</h2>
      <table><tr><th>Grant</th><th>Funder</th><th>Stage</th><th>Requested</th><th>Awarded</th></tr>${rows}</table>
      </body></html>`);
  };

  const submittedRows = filtered.filter((r) =>
    ["submitted", "under_review", "info_requested", "awarded", "declined"].includes(r.stage),
  );
  const awardedRows = filtered.filter((r) => r.stage === "awarded");
  const decidedRows = filtered.filter((r) => r.stage === "awarded" || r.stage === "declined");
  const pipelineRows = filtered.filter((r) =>
    ["submitted", "under_review", "info_requested"].includes(r.stage),
  );

  const kpis = [
    {
      label: "Total Submitted",
      value: String(summary.submittedCount),
      sub: compactMoney(summary.submittedValue),
      rows: submittedRows,
    },
    {
      label: "Total Awarded",
      value: String(summary.awardedCount),
      sub: compactMoney(summary.awardedValue),
      rows: awardedRows,
    },
    {
      label: "Win Rate",
      value: summary.winRate === null ? "—" : `${summary.winRate}%`,
      sub: "awarded ÷ decided",
      rows: decidedRows,
    },
    {
      label: "Funding in Pipeline",
      value: compactMoney(summary.pipelineValue),
      sub: "under review",
      rows: pipelineRows,
    },
  ];


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="month">This month</SelectItem>
            <SelectItem value="quarter">This quarter</SelectItem>
            <SelectItem value="year">This year</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
        <Select value={funderType} onValueChange={setFunderType}>
          <SelectTrigger className="w-40">
            <SelectValue />
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
        <Select value={focusArea} onValueChange={setFocusArea}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All focus areas</SelectItem>
            {focusAreas.map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {whiteLabel && (
          <Input
            className="w-48"
            placeholder="Client name on report"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />
        )}
        <Button variant="outline" size="sm" className="ml-auto" onClick={exportPdf}>
          {canExportPdf ? <FileDown className="mr-2 size-4" /> : <Lock className="mr-2 size-4" />}
          Export PDF report
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => openDrill(k.label, k.rows)}
            className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="mt-2 text-2xl font-extrabold text-foreground">{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.sub}</p>
            <p className="mt-2 text-[11px] font-semibold text-primary">
              View {k.rows.length} grant{k.rows.length === 1 ? "" : "s"} →
            </p>
          </button>
        ))}
      </div>


      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Funding pipeline by stage">
          <BarChart
            data={byStage}
            layout="vertical"
            margin={{ left: 40 }}
            onClick={(st: { activeLabel?: string }) => {
              const label = st?.activeLabel;
              if (!label) return;
              const stage = STAGES.find((s) => s.label === label);
              if (!stage) return;
              openDrill(
                `Stage: ${label}`,
                filtered.filter((r) => r.stage === stage.id),
              );
            }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => compactMoney(v)} fontSize={11} />
            <YAxis type="category" dataKey="stage" width={130} fontSize={11} />
            <Tooltip formatter={(v: number) => formatMoney(v)} />
            <Bar dataKey="value" fill="hsl(var(--primary))" radius={4} className="cursor-pointer" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Awards by funder type">
          <PieChart>
            <Pie
              data={awardsByType}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={90}
              className="cursor-pointer"
              onClick={(slice: { name?: string }) =>
                slice?.name &&
                openDrill(
                  `Awards — ${slice.name}`,
                  filtered.filter((r) => r.stage === "awarded" && r.funder_type === slice.name),
                )
              }
            >
              {awardsByType.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Legend />
            <Tooltip formatter={(v: number) => formatMoney(v)} />
          </PieChart>
        </ChartCard>

        <ChartCard title="Monthly submission activity">
          <BarChart
            data={monthly}
            onClick={(st: { activeLabel?: string }) => {
              const label = st?.activeLabel;
              if (!label) return;
              const month = lastTwelveMonths().find((m) => m.slice(5) === label);
              if (!month) return;
              openDrill(
                `Submitted in ${month}`,
                filtered.filter((r) => (r.submission_date ?? "").startsWith(month)),
              );
            }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="month" fontSize={11} />
            <YAxis allowDecimals={false} fontSize={11} />
            <Tooltip />
            <Bar dataKey="submissions" fill="hsl(var(--accent))" radius={4} className="cursor-pointer" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Win rate by funder type">
          <BarChart
            data={winRateByType}
            onClick={(st: { activeLabel?: string }) =>
              st?.activeLabel &&
              openDrill(
                `Decided — ${st.activeLabel}`,
                filtered.filter(
                  (r) =>
                    r.funder_type === st.activeLabel &&
                    (r.stage === "awarded" || r.stage === "declined"),
                ),
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" fontSize={11} />
            <YAxis unit="%" fontSize={11} />
            <Tooltip formatter={(v: number) => `${v}%`} />
            <Bar dataKey="winRate" fill="hsl(var(--primary))" radius={4} className="cursor-pointer" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Award amount vs. requested">
          <BarChart
            data={awardedVsRequested}
            onClick={(st: { activeLabel?: string }) =>
              st?.activeLabel &&
              openDrill(
                `Award — ${st.activeLabel}`,
                filtered.filter(
                  (r) => r.stage === "awarded" && r.grant_name.slice(0, 18) === st.activeLabel,
                ),
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="name" fontSize={10} />
            <YAxis tickFormatter={(v: number) => compactMoney(v)} fontSize={11} />
            <Tooltip formatter={(v: number) => formatMoney(v)} />
            <Legend />
            <Bar dataKey="requested" fill="hsl(var(--muted-foreground))" radius={4} className="cursor-pointer" />
            <Bar dataKey="awarded" fill="hsl(var(--accent))" radius={4} className="cursor-pointer" />
          </BarChart>
        </ChartCard>

        <ChartCard title="Funding by focus area">
          <BarChart
            data={fundingByFocus}
            layout="vertical"
            margin={{ left: 40 }}
            onClick={(st: { activeLabel?: string }) =>
              st?.activeLabel &&
              openDrill(
                `Awarded — ${st.activeLabel}`,
                filtered.filter(
                  (r) => r.stage === "awarded" && r.focus_areas.includes(st.activeLabel as string),
                ),
              )
            }
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => compactMoney(v)} fontSize={11} />
            <YAxis type="category" dataKey="name" width={130} fontSize={11} />
            <Tooltip formatter={(v: number) => formatMoney(v)} />
            <Bar dataKey="value" fill="#8b5cf6" radius={4} className="cursor-pointer" />
          </BarChart>
        </ChartCard>
      </div>


      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-bold text-foreground">Year over year</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {yoy.map((y) => (
            <button
              key={y.year}
              type="button"
              onClick={() =>
                openDrill(
                  `Grants in ${y.year}`,
                  records.filter((r) => (r.submission_date ?? r.created_at).startsWith(y.year)),
                )
              }
              className="rounded-lg border border-border bg-background p-3 text-left text-sm transition hover:border-primary"
            >
              <p className="font-bold text-foreground">{y.year}</p>
              <p className="text-muted-foreground">
                {y.submissions} submissions · {y.awards} awards · {formatMoney(y.funding)} received
              </p>
            </button>
          ))}
        </div>
      </div>

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{drill?.title}</DialogTitle>
            <DialogDescription>
              {drill?.rows.length ?? 0} grant{drill?.rows.length === 1 ? "" : "s"} behind this
              number. Open any one to see the full record.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {drill?.rows.map((r) => (
              <Link
                key={r.id}
                to="/tracker/$id"
                params={{ id: r.id }}
                onClick={() => setDrill(null)}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm transition hover:border-primary"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{r.grant_name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.funder} · {STAGE_LABEL[r.stage] ?? r.stage}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-foreground">
                  {formatMoney(r.awarded_amount ?? r.requested_amount)}
                </span>
              </Link>
            ))}
            {!drill?.rows.length && (
              <p className="text-sm text-muted-foreground">No grants match this selection yet.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
