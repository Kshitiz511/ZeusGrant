import { useState } from "react";
import { ArrowRight, CalendarClock, FileText, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useParallax } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Hero.
 *
 * Depth comes from four layers moving at different rates: the aurora wash, the
 * grid, two floating glass panels, and the foreground content which does not
 * move at all. Keeping the text static matters -- parallaxing the thing someone
 * is trying to read is the most common way this effect goes wrong.
 */
export function Hero({ onNavigate }: { onNavigate: (to: string) => void }) {
  const slow = useParallax(0.12);
  const medium = useParallax(0.22);
  const fast = useParallax(0.34);

  return (
    <section className="relative isolate overflow-hidden pb-24 pt-32 sm:pb-28 md:pb-36 md:pt-40">
      {/* Layer 1 — ambient colour wash. */}
      <div
        aria-hidden
        className="bg-aurora animate-drift pointer-events-none absolute inset-0 -z-30"
        style={{ transform: `translate3d(0, ${slow}px, 0)` }}
      />
      {/* Layer 2 — engineering grid, masked so it fades out rather than
          stopping at a hard edge. */}
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-20 opacity-70"
        style={{
          transform: `translate3d(0, ${medium}px, 0)`,
          maskImage: "radial-gradient(75% 55% at 50% 35%, black, transparent 100%)",
          WebkitMaskImage: "radial-gradient(75% 55% at 50% 35%, black, transparent 100%)",
        }}
      />

      {/* Layer 3 — floating glass panels. Confined to the upper band: lower
          down they travel across the preview card and past the edge of the
          viewport once scroll parallax and the float animation compound.
          Hidden on small screens, where they read as clutter rather than
          depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 hidden h-[60%] overflow-hidden lg:block"
        style={{ transform: `translate3d(0, ${-fast}px, 0)` }}
      >
        <div className="glass animate-float absolute left-[7%] top-[30%] size-24 rounded-3xl" />
        <div
          className="glass animate-float absolute right-[9%] top-[24%] size-16 rounded-2xl"
          style={{ animationDelay: "1.4s" }}
        />
        <div
          className="glass animate-float absolute left-[13%] top-[62%] size-20 rounded-[1.75rem]"
          style={{ animationDelay: "2.8s" }}
        />
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="animate-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-4 py-1.5 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              Built for grant-funded organizations
            </span>
          </div>

          <h1
            className="animate-fade-up mt-7 text-balance text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-5xl md:text-6xl lg:text-[4.25rem]"
            style={{ animationDelay: "80ms" }}
          >
            Win the funding.
            <br />
            Then <span className="text-gradient-brand">prove you delivered.</span>
          </h1>

          <p
            className="animate-fade-up mx-auto mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
            style={{ animationDelay: "160ms" }}
          >
            Zeus is two services on one platform. Grant Intelligence scores every open
            opportunity against your profile. Contract Compliance reads the agreement you
            signed and tracks every obligation in it. Buy either one on its own.
          </p>

          <div
            className="animate-fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            style={{ animationDelay: "240ms" }}
          >
            <Button
              variant="hero"
              size="xl"
              className="sheen-on-hover w-full sm:w-auto"
              onClick={() => onNavigate("/signup")}
            >
              Create your account
              <ArrowRight className="size-4" />
            </Button>
            <Button
              variant="glass"
              size="xl"
              className="w-full sm:w-auto"
              onClick={() => onNavigate("/login")}
            >
              Sign in
            </Button>
          </div>

          <p
            className="animate-fade-up mt-5 text-xs text-muted-foreground"
            style={{ animationDelay: "300ms" }}
          >
            No credit card to start · Cancel anytime
          </p>
        </div>

        {/* Product preview. Real representations of both live services rather
            than stock screenshots, so the promise above is legible. */}
        <div
          className="animate-fade-up mt-16 sm:mt-20"
          style={{ animationDelay: "380ms" }}
        >
          <ProductPreview offset={slow} />
        </div>
      </div>
    </section>
  );
}

const OBLIGATIONS = [
  {
    title: "Submit quarterly financial report",
    due: "Mar 31",
    tone: "high" as const,
    clause: "§3.2 — Recipient shall submit financial reports quarterly.",
  },
  {
    title: "Maintain SOC 2 Type II certification",
    due: "Jun 30",
    tone: "medium" as const,
    clause: "§4.1 — Provider shall maintain certification throughout the Term.",
  },
  {
    title: "Notify of security incident within 24h",
    due: "Ongoing",
    tone: "high" as const,
    clause: "§4.2 — Notice within twenty-four (24) hours of discovery.",
  },
  {
    title: "Designate a project sponsor",
    due: "Jan 29",
    tone: "low" as const,
    clause: "§2.1 — Within ten (10) business days of the Effective Date.",
  },
];

/**
 * Sample matches.
 *
 * The reasons are shown because that is the actual product: the score is not
 * the feature, the fact that you can see where it came from is. A preview that
 * showed only a number would be advertising the thing we deliberately did not
 * build.
 */
const MATCHES = [
  {
    title: "Community Health Infrastructure Program",
    agency: "HHS · HRSA",
    score: 92,
    reasons: ["Eligibility match", "Operates in TX", "Award fits range"],
  },
  {
    title: "Rural Broadband Equity Initiative",
    agency: "USDA · Rural Development",
    score: 78,
    reasons: ["Focus area match", "Open 41 days"],
  },
  {
    title: "Youth Workforce Development Grant",
    agency: "DOL · ETA",
    score: 64,
    reasons: ["Population served", "Cost share required"],
  },
];

/**
 * A preview of both live services.
 *
 * Tabbed rather than stacked: the two services are peers, and showing one
 * above the other would re-create the impression that the platform is one
 * product with an extra feature.
 */
function ProductPreview({ offset }: { offset: number }) {
  const [tab, setTab] = useState<"matches" | "obligations">("matches");

  return (
    <div
      className="glass-strong relative mx-auto max-w-4xl rounded-[1.75rem] p-2.5 sm:p-3"
      style={{ transform: `translate3d(0, ${-offset * 0.35}px, 0)` }}
    >
      <div className="overflow-hidden rounded-[1.35rem] border border-border/60 bg-background">
        {/* Window chrome doubling as the service switch. */}
        <div className="flex items-center gap-2 border-b border-border/70 bg-muted/50 px-4 py-3">
          <span className="hidden size-2.5 rounded-full bg-destructive/30 sm:inline-block" />
          <span className="hidden size-2.5 rounded-full bg-warning/40 sm:inline-block" />
          <span className="hidden size-2.5 rounded-full bg-success/40 sm:inline-block" />
          <div className="flex min-w-0 items-center gap-1 sm:ml-3">
            <PreviewTab active={tab === "matches"} onClick={() => setTab("matches")} icon={Target}>
              Matches
            </PreviewTab>
            <PreviewTab
              active={tab === "obligations"}
              onClick={() => setTab("obligations")}
              icon={FileText}
            >
              Obligations
            </PreviewTab>
          </div>
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            Example
          </span>
        </div>

        {tab === "matches" ? <MatchRows /> : <ObligationRows />}
      </div>
    </div>
  );
}

function PreviewTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200",
        active
          ? "bg-background text-ink shadow-soft"
          : "text-muted-foreground hover:text-ink",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </button>
  );
}

function MatchRows() {
  return (
    <ul className="divide-y divide-border/60">
      {MATCHES.map((m) => (
        <li
          key={m.title}
          className="flex items-start gap-3 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-muted/40 sm:px-5"
        >
          <span
            className={cn(
              "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-lg px-2 py-1 text-xs font-extrabold",
              m.score >= 75 ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {m.score}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{m.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{m.agency}</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {m.reasons.map((r) => (
                <span
                  key={r}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {r}
                </span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ObligationRows() {
  return (
    <ul className="divide-y divide-border/60">
      {OBLIGATIONS.map((o) => (
        <li
          key={o.title}
          className="flex items-start gap-3 px-4 py-3.5 text-left transition-colors duration-200 hover:bg-muted/40 sm:px-5"
        >
          <span
            className={cn(
              "mt-1.5 size-2 shrink-0 rounded-full",
              o.tone === "high"
                ? "bg-destructive"
                : o.tone === "medium"
                  ? "bg-warning"
                  : "bg-success",
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{o.title}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{o.clause}</p>
          </div>
          <span className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
            <CalendarClock className="size-3" />
            {o.due}
          </span>
        </li>
      ))}
    </ul>
  );
}
