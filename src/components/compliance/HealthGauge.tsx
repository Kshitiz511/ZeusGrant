import { healthTone } from "@/lib/compliance";
import { cn } from "@/lib/utils";

const TONE_STROKE = {
  good: "stroke-emerald-500",
  warn: "stroke-yellow-500",
  bad: "stroke-destructive",
} as const;

export function HealthGauge({ score, size = 96 }: { score: number; size?: number }) {
  const tone = healthTone(score);
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-3">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Compliance health score ${score} out of 100`}>
        <circle cx="50" cy="50" r={r} className="fill-none stroke-muted" strokeWidth="10" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className={cn("fill-none transition-all", TONE_STROKE[tone])}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(c * score) / 100} ${c}`}
          transform="rotate(-90 50 50)"
        />
        <text
          x="50"
          y="56"
          textAnchor="middle"
          className="fill-foreground text-[22px] font-extrabold"
        >
          {score}
        </text>
      </svg>
      <div>
        <p className="text-sm font-bold text-foreground">Compliance health</p>
        <p className="text-xs text-muted-foreground">
          Completed on time + not yet due, over all tasks
        </p>
      </div>
    </div>
  );
}
