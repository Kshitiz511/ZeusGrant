import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Shared chrome for the admin sections, so each one does not reinvent it. */

export function Panel({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          {title && <h3 className="text-sm font-semibold text-foreground">{title}</h3>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted-foreground">{children}</p>;
}

/**
 * An error, shown rather than swallowed.
 *
 * An admin screen that silently renders an empty table when its request fails
 * is indistinguishable from a platform with no tenants, which is the single
 * most misleading thing this console could do.
 */
export function Failed({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : "Request failed.";
  return (
    <div className="px-5 py-8 text-center">
      <p className="text-sm font-medium text-destructive">Could not load this section</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "warn" | "bad";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-left",
        onClick && "transition-colors hover:border-primary/50",
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums",
          tone === "warn" && "text-amber-600",
          tone === "bad" && "text-destructive",
          (!tone || tone === "default") && "text-foreground",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Tag>
  );
}

export function Pill({ children, tone }: { children: ReactNode; tone: "ok" | "warn" | "bad" | "mute" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-700",
        tone === "warn" && "bg-amber-500/10 text-amber-700",
        tone === "bad" && "bg-destructive/10 text-destructive",
        tone === "mute" && "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Cents to a readable price. Null means the plan carries no price at all. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}`;
}

export function when(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
