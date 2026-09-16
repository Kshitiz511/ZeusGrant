import { useState } from "react";
import { Activity, Coins, Info, TrendingUp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost, formatNumber, formatTokens } from "@/lib/format";
import { useIsTenantAdmin, useUsage, useUsageBySeat } from "@/lib/hooks";
import type { ModuleUsage, UsageDay } from "@/lib/types";

// What this workspace has spent on AI, and who spent it.
//
// The one rule this screen must never break: a cost we cannot price is never
// rendered as a number. If a model ran that is missing from the price table,
// the total carries a "+" and the count is stated plainly. That honesty lives
// in formatCost so no panel here can forget it. A confidently wrong bill is
// worse than an openly incomplete one.

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

const MODULE_NAMES: Record<string, string> = {
  contract_compliance: "Contract compliance",
  grant_intelligence: "Grant intelligence",
  proposals: "Proposals",
  audit_vault: "Audit vault",
};

const moduleName = (id: string) => MODULE_NAMES[id] ?? id.replace(/_/g, " ");

export function UsageView() {
  const [days, setDays] = useState<number>(30);
  const { isAdmin } = useIsTenantAdmin();
  const { data, isLoading, error } = useUsage(days);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          AI work done for this workspace, and what it cost.
        </p>
        <div className="flex rounded-lg border border-border p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={
                "rounded-md px-3 py-1 text-xs font-medium transition-colors " +
                (days === r.days
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-destructive">
          {(error as Error).message}
        </div>
      ) : !data || data.totals.calls === 0 ? (
        <EmptyUsage days={days} />
      ) : (
        <>
          <Totals
            calls={data.totals.calls}
            tokens={data.totals.total_tokens}
            cost={data.totals.cost_usd}
            unpriced={data.totals.unpriced_calls}
          />
          {data.totals.unpriced_calls > 0 && (
            <UnpricedNotice count={data.totals.unpriced_calls} />
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <ByModule rows={data.by_module} />
            <DailyChart days={data.series} />
          </div>
          {isAdmin && <BySeat days={days} />}
        </>
      )}
    </div>
  );
}

function EmptyUsage({ days }: { days: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <Activity className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-3 font-bold text-foreground">Nothing yet</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        No AI work has run in this workspace in the last {days} days. Upload a contract or
        run a funding scan and the cost will show up here.
      </p>
    </div>
  );
}

function Totals({
  calls,
  tokens,
  cost,
  unpriced,
}: {
  calls: number;
  tokens: number;
  cost: number | null;
  unpriced: number;
}) {
  const cards = [
    { icon: Activity, label: "AI calls", value: formatNumber(calls) },
    { icon: TrendingUp, label: "Tokens", value: formatTokens(tokens) },
    { icon: Coins, label: "Cost", value: formatCost(cost, unpriced) },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <c.icon className="size-4" />
            <span className="text-xs font-semibold uppercase tracking-wide">{c.label}</span>
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function UnpricedNotice({ count }: { count: number }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
      <Info className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="text-xs text-foreground">
        {count} call{count === 1 ? "" : "s"} ran on a model we do not yet have a price for,
        so the real total is higher than shown. That is why the figure carries a plus.
      </p>
    </div>
  );
}

function ByModule({ rows }: { rows: ModuleUsage[] }) {
  // Shares are of priced spend only. Mixing unpriced calls into a percentage
  // would invent a denominator we do not have.
  const total = rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-bold text-foreground">Where it went</h2>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const share = total > 0 ? ((r.cost_usd ?? 0) / total) * 100 : 0;
          return (
            <li key={r.module_id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-4">
                <span className="truncate text-sm font-medium capitalize text-foreground">
                  {moduleName(r.module_id)}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatCost(r.cost_usd, r.unpriced_calls)}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.max(share, 1)}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {formatNumber(r.calls)} call{r.calls === 1 ? "" : "s"} ·{" "}
                {formatTokens(r.total_tokens)} tokens
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function DailyChart({ days }: { days: UsageDay[] }) {
  // The server fills gaps with generate_series, so a quiet day is a real zero
  // rather than a missing bar that makes activity look continuous.
  const peak = Math.max(...days.map((d) => d.cost_usd ?? 0), 0);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-bold text-foreground">Day by day</h2>
      </div>
      <div className="p-5">
        {peak === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No priced activity in this period.
          </p>
        ) : (
          <div className="flex h-40 items-end gap-0.5">
            {days.map((d) => (
              <div
                key={d.day}
                className="group relative flex-1 rounded-t bg-primary/70 transition-colors hover:bg-primary"
                style={{
                  height: `${Math.max(((d.cost_usd ?? 0) / peak) * 100, 2)}%`,
                }}
              >
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100">
                  {d.day} · {formatCost(d.cost_usd, d.unpriced_calls)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BySeat({ days }: { days: number }) {
  const { data, isLoading, error } = useUsageBySeat(days);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (error || !data) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-bold text-foreground">By person</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Only owners and admins can see this breakdown.
        </p>
      </div>
      {data.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          Nothing attributable to a person in this period. Background work that runs for
          the whole workspace is not counted against anyone.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((a) => (
            <li
              key={a.actor_id ?? "system"}
              className="flex items-center justify-between gap-4 px-5 py-3.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {a.full_name ?? a.email ?? "Automated background work"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(a.calls)} call{a.calls === 1 ? "" : "s"} ·{" "}
                  {formatTokens(a.total_tokens)} tokens
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {formatCost(a.cost_usd, a.unpriced_calls)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
