import { Link } from "@tanstack/react-router";
import { Brain } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useProfileStrength } from "@/hooks/useProfileStrength";

const RING: Record<string, string> = {
  empty: "text-muted-foreground",
  minimal: "text-rose-500",
  basic: "text-amber-500",
  good: "text-primary",
  strong: "text-emerald-500",
  elite: "text-yellow-500",
};

export function ProfileStrengthGauge({ score, tier }: { score: number; tier: string }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className={`size-9 ${RING[tier] ?? "text-primary"}`}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 18 18)"
      />
      <text x="18" y="21" textAnchor="middle" className="fill-current text-[10px] font-bold">
        {score}
      </text>
    </svg>
  );
}

/** Persistent profile strength indicator shown in the app top bar. */
export function ProfileStrengthIndicator() {
  const { strength, loading } = useProfileStrength();
  if (loading || !strength) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full border border-border bg-card px-2 py-1 transition-colors hover:bg-accent"
          aria-label={`Profile strength ${strength.score}%`}
        >
          <ProfileStrengthGauge score={strength.score} tier={strength.tier} />
          <span className="hidden text-xs font-semibold text-foreground sm:inline">
            {strength.tierLabel}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-bold text-foreground">
          Profile is {strength.score}% complete
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{strength.tierLabel}</p>
        {strength.topActions.length > 0 && (
          <>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top 3 things to add now
            </p>
            <ul className="mt-2 space-y-1">
              {strength.topActions.map((a) => (
                <li key={a.label}>
                  <Link
                    to="/profile"
                    search={{ tab: a.tab }}
                    className="text-sm text-primary hover:underline"
                  >
                    {a.label}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <Button asChild size="sm" className="mt-4 w-full">
          <Link to="/profile">
            <Brain className="mr-2 size-4" /> Go to Profile Intelligence
          </Link>
        </Button>
      </PopoverContent>
    </Popover>
  );
}
