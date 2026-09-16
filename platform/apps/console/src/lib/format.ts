import type { Priority } from "./types";

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function priorityVariant(p: Priority): "destructive" | "warning" | "secondary" {
  if (p === "high") return "destructive";
  if (p === "medium") return "warning";
  return "secondary";
}

/**
 * Render a cost that may not be knowable.
 *
 * The whole usage pipeline is careful to keep "unknown" distinct from "zero" --
 * an unpriced model records tokens with a null cost rather than 0.00, because a
 * confident $0.00 is how a runaway bill stays invisible. That care is wasted if
 * the last step renders null as "$0.00", so the conversion lives here, once,
 * instead of in every component that shows money.
 *
 * `unpriced` > 0 means the figure is a lower bound: some calls in the period
 * used a model with no configured price and contributed nothing to the sum.
 */
export function formatCost(value: number | null | undefined, unpriced = 0): string {
  if (value === null || value === undefined) return unpriced > 0 ? "Unknown" : "—";
  const amount =
    value > 0 && value < 0.01
      ? // Sub-cent amounts are common on cheap models, and rounding them to
        // "$0.00" makes real usage look like no usage.
        `$${value.toFixed(4)}`
      : `$${value.toFixed(2)}`;
  return unpriced > 0 ? `${amount}+` : amount;
}

/** Thousands separators, or an em dash for nothing at all. */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

/** Large token counts, shortened. 1_240_000 becomes "1.2M". */
export function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
