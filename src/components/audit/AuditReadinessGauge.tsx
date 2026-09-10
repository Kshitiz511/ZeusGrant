import { BAND_CLASS, BAND_LABEL, type AuditReadiness } from "@/lib/audit";
import { cn } from "@/lib/utils";

const TONE = {
  ready: "stroke-emerald-500",
  mostly: "stroke-sky-500",
  partial: "stroke-yellow-500",
  not_ready: "stroke-destructive",
} as const;

export function AuditReadinessGauge({
  readiness,
  size = 96,
}: {
  readiness: AuditReadiness;
  size?: number;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Audit readiness score ${readiness.score} out of 100`}
      >
        <circle cx="50" cy="50" r={r} className="fill-none stroke-muted" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className={cn("fill-none transition-all", TONE[readiness.band])}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(c * readiness.score) / 100} ${c}`}
          transform="rotate(-90 50 50)"
        />
        <text x="50" y="56" textAnchor="middle" className="fill-foreground text-[22px] font-extrabold">
          {readiness.score}
        </text>
      </svg>
      <div>
        <p className="text-sm font-bold text-foreground">Audit readiness</p>
        <span
          className={cn(
            "mt-1 inline-block rounded-full border px-2 py-0.5 text-xs font-semibold",
            BAND_CLASS[readiness.band],
          )}
        >
          {BAND_LABEL[readiness.band]}
        </span>
        <p className="mt-1 text-xs text-muted-foreground">
          {readiness.documented} of {readiness.expected} due or completed obligations have evidence
          on file
        </p>
      </div>
    </div>
  );
}
