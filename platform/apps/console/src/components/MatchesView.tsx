import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  Calendar,
  ExternalLink,
  Loader2,
  Radar,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import {
  useMatchSummary,
  useMatches,
  useRequestScan,
  useScanProgress,
  useSetMatchState,
} from "@/lib/hooks";
import type { Match } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Scored funding matches.
 *
 * Every score is shown with the reasons behind it. A bare number is what made
 * the old fit score impossible to trust, so the breakdown is part of the row
 * rather than something to dig for.
 *
 * Two server responses are normal states here, not failures: 402 means the
 * plan's scan allowance is spent, and 409 means the funding profile is not
 * complete enough to score against. Both get a next step instead of an error.
 */
export function MatchesView({ onNavigate }: { onNavigate: (key: string) => void }) {
  const [savedOnly, setSavedOnly] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const { data, isLoading, error } = useMatches({ savedOnly });
  const { data: summary } = useMatchSummary();
  const scan = useRequestScan();
  const progress = useScanProgress(jobId);
  const setState = useSetMatchState();

  const status = progress.data?.status;
  const scanning =
    scan.isPending || status === "queued" || status === "running";

  const startScan = () =>
    scan.mutate(undefined, { onSuccess: (r) => setJobId(r.job_id) });

  const scans = summary?.scans;
  const outOfScans = !!scans && scans.remaining <= 0;
  const blocked = readBlock(scan.error);

  const matches = data?.matches ?? [];

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={Target}
          label="Open matches"
          value={summary ? String(summary.active) : "—"}
          hint={summary?.last_scored_at ? `scored ${when(summary.last_scored_at)}` : "run a scan to begin"}
        />
        <StatCard
          icon={Trophy}
          label="Strong fits"
          value={summary ? String(summary.strong) : "—"}
          hint="scoring 70 or above"
        />
        <StatCard
          icon={Radar}
          label="Scans left"
          value={scans ? String(scans.remaining) : "—"}
          hint={scans ? `${scans.used} of ${scans.limit} used this month` : "on your plan"}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FilterTab active={!savedOnly} onClick={() => setSavedOnly(false)}>
            All matches
          </FilterTab>
          <FilterTab active={savedOnly} onClick={() => setSavedOnly(true)}>
            Saved{summary ? ` (${summary.saved})` : ""}
          </FilterTab>
        </div>
        <Button variant="hero" size="sm" onClick={startScan} disabled={scanning || outOfScans}>
          {scanning ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Radar className="mr-2 size-4" />
          )}
          {scanning ? "Scanning…" : "Run scan"}
        </Button>
      </div>

      {scanning && (
        <Notice tone="info">
          Scanning the funding catalogue against your profile. This keeps running if you leave the
          page — matches appear here when it finishes.
        </Notice>
      )}

      {blocked === "profile" && (
        <Notice tone="warn">
          <span>Your funding profile needs a few more details before it can be scored.</span>
          <Button size="sm" variant="outline" onClick={() => onNavigate("/funding-profile")}>
            Complete profile
          </Button>
        </Notice>
      )}

      {blocked === "quota" && (
        <Notice tone="warn">
          <span>You have used every scan on your plan this month.</span>
          <Button size="sm" variant="outline" onClick={() => onNavigate("/billing")}>
            View plans
          </Button>
        </Notice>
      )}

      {blocked === "other" && <Notice tone="error">{(scan.error as Error).message}</Notice>}

      {progress.data?.status === "failed" && (
        <Notice tone="error">
          The last scan did not finish. {progress.data.last_error ?? "Try running it again."}
        </Notice>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Notice tone="error">{(error as Error).message}</Notice>
      ) : matches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <h2 className="text-lg font-bold text-foreground">
            {savedOnly ? "Nothing saved yet" : "No matches yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            {savedOnly
              ? "Save a match to keep it here while you decide whether to apply."
              : "Fill in your funding profile, then run a scan. We score every open opportunity against your eligibility, geography, focus areas and award size — and show you why each one scored what it did."}
          </p>
          {!savedOnly && (
            <div className="mt-5 flex justify-center gap-2">
              <Button variant="outline" onClick={() => onNavigate("/funding-profile")}>
                Edit profile
              </Button>
              <Button variant="hero" onClick={startScan} disabled={scanning || outOfScans}>
                <Radar className="mr-2 size-4" /> Run scan
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {matches.map((m) => (
              <MatchCard
                key={m.match_id}
                match={m}
                busy={setState.isPending}
                onSave={() => setState.mutate({ opportunityId: m.id, saved: !m.saved_at })}
                onDismiss={() => setState.mutate({ opportunityId: m.id, dismissed: true })}
              />
            ))}
          </div>

          {data?.truncated && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <span className="text-muted-foreground">
                Showing your top {data.visible_limit} of {data.total} matches on this plan.
              </span>
              <Button size="sm" variant="outline" onClick={() => onNavigate("/billing")}>
                See all matches
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MatchCard({
  match,
  busy,
  onSave,
  onDismiss,
}: {
  match: Match;
  busy: boolean;
  onSave: () => void;
  onDismiss: () => void;
}) {
  const saved = !!match.saved_at;
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-lift">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-bold text-foreground">{match.title}</h2>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {match.agency_name || "Agency not stated"}
            {match.opportunity_number ? ` · ${match.opportunity_number}` : ""}
          </p>
        </div>
        <ScoreBadge score={match.score} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(match.award_floor != null || match.award_ceiling != null) && (
          <span>{awardRange(match.award_floor, match.award_ceiling)}</span>
        )}
        {match.closes_on && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="size-3.5" /> Closes {when(match.closes_on)}
          </span>
        )}
        {match.is_forecast && <Badge variant="secondary">Forecast</Badge>}
        {match.cost_sharing_required && <span>Cost share required</span>}
      </div>

      <Reasons reasons={match.reasons} />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={saved ? "secondary" : "outline"} disabled={busy} onClick={onSave}>
          {saved ? (
            <BookmarkCheck className="mr-2 size-4" />
          ) : (
            <Bookmark className="mr-2 size-4" />
          )}
          {saved ? "Saved" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDismiss}>
          <X className="mr-2 size-4" /> Not relevant
        </Button>
        {match.source_url && (
          <a
            href={match.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            Open notice <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * The scorer's own breakdown, shown as-is.
 *
 * Nothing is recomputed here. If the displayed reasons and the score ever
 * disagreed, that would be a bug in the scorer worth seeing rather than one
 * this component papers over.
 */
function Reasons({ reasons }: { reasons: Match["reasons"] }) {
  const entries = Object.entries(reasons ?? {}).filter(([, v]) => v !== null && v !== false);
  if (entries.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <Badge key={k} variant="secondary" className="font-normal">
          {label(k)}
          {typeof v === "number" ? ` +${Math.round(v)}` : typeof v === "string" ? `: ${v}` : ""}
        </Badge>
      ))}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const n = Math.round(score);
  return (
    <div
      className={cn(
        "shrink-0 rounded-lg px-3 py-1.5 text-center",
        n >= 75
          ? "bg-primary/15 text-primary"
          : n >= 50
            ? "bg-yellow-500/15 text-yellow-600"
            : "bg-muted text-muted-foreground",
      )}
    >
      <p className="text-lg font-extrabold leading-none">{n}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide">score</p>
    </div>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warn" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-6 flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm",
        tone === "info" && "border-primary/40 bg-primary/5",
        tone === "warn" && "border-yellow-500/40 bg-yellow-500/10",
        tone === "error" && "border-destructive/40 bg-destructive/5 text-destructive",
      )}
    >
      {children}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label: text,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-lift">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{text}</p>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-2 text-2xl font-extrabold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Turn a scan rejection into the one next step that clears it. */
function readBlock(error: unknown): "profile" | "quota" | "other" | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 409) return "profile";
    if (error.status === 402) return "quota";
  }
  return "other";
}

function label(key: string): string {
  return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

function awardRange(min: number | null, max: number | null): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  if (max != null) return `up to ${fmt(max)}`;
  if (min != null) return `from ${fmt(min)}`;
  return "";
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
