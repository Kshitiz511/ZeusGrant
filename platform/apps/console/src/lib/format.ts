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
