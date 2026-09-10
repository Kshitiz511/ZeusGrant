import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { DraftLimitDialog } from "@/components/app/DraftLimitDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { formatAward, rankOpportunities, sourceTypeLabel, type Match } from "@/lib/matching";
import { GEO_LABEL, type GeoClassification } from "@/lib/geography";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { formatLimit } from "@/lib/entitlements";
import { useGrantTracker } from "@/hooks/useGrantTracker";
import { useProfileStrength } from "@/hooks/useProfileStrength";

import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_authenticated/opportunities")({
  head: () => ({
    meta: [
      { title: "Funding matches — ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Personalized grant matches scored against your organization profile, with transparent eligibility reasoning.",
      },
      { property: "og:title", content: "Funding matches — ZCS GrantMatch Innovation" },
      { property: "og:description", content: "Scored grant matches for your organization." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OpportunitiesPage,
});

type Filter = "all" | "eligible" | "saved";

function OpportunitiesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    hasAccess,
    loading: entLoading,
    limits,
    matchesRemaining,
    canSaveMore,
    savedCount,
    canCreateProposal,
    cycleEnd,
    recordMatchesViewed,
    consumeProposalDraft,
    refetch: refetchEntitlements,
  } = useEntitlements(user?.id);

  const { strength, canMatch } = useProfileStrength();
  const [limitOpen, setLimitOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [geoFilter, setGeoFilter] = useState<GeoClassification | "any">("any");


  const orgQuery = useQuery({
    queryKey: ["org-profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("org_profiles").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const oppsQuery = useQuery({
    queryKey: ["opportunities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const savedQuery = useQuery({
    queryKey: ["saved-opportunities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("saved_opportunities").select("*");
      if (error) throw error;
      return data;
    },
  });

  const savedSlugs = useMemo(
    () => new Set((savedQuery.data ?? []).map((s) => s.opportunity_slug)),
    [savedQuery.data],
  );

  const { records: trackerRecords, addRecord } = useGrantTracker(user?.id);
  const trackedSlugs = useMemo(
    () => new Set(trackerRecords.map((r) => r.opportunity_slug).filter(Boolean) as string[]),
    [trackerRecords],
  );

  const addToTracker = async (m: Match) => {
    try {
      await addRecord({
        grant_name: m.opportunity.title,
        funder: m.opportunity.funder,
        funder_type: m.opportunity.funder_type,
        focus_areas: m.opportunity.focus_areas,
        requested_amount: m.opportunity.award_max ?? m.opportunity.award_min ?? null,
        deadline: m.opportunity.deadline,
        match_score: m.score,
        portal_url: m.opportunity.application_url,
        opportunity_id: m.opportunity.id,
        opportunity_slug: m.opportunity.slug,
        stage: "identified",
      });
      toast.success("Added to your Grant Tracker.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to the tracker");
    }
  };

  const toggleSave = useMutation({
    mutationFn: async (slug: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("Not signed in");
      if (savedSlugs.has(slug)) {
        const { error } = await supabase
          .from("saved_opportunities")
          .delete()
          .eq("opportunity_slug", slug);
        if (error) throw error;
        return "removed" as const;
      }
      if (!canSaveMore) {
        throw new Error(
          `Your plan allows up to ${formatLimit(limits.saved_opportunities_max)} saved opportunities. Upgrade to save more.`,
        );
      }
      const { error } = await supabase
        .from("saved_opportunities")
        .insert({ user_id: userId, opportunity_slug: slug });
      if (error) throw error;
      return "saved" as const;
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["saved-opportunities"] });
      void refetchEntitlements();
      toast.success(result === "saved" ? "Saved to your tracker" : "Removed from your tracker");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createProposal = useMutation({
    mutationFn: async (m: Match) => {
      if (!user) throw new Error("Not signed in");
      if (!canCreateProposal) throw new Error("DRAFT_LIMIT_REACHED");

      const { data: existing } = await supabase
        .from("proposals")
        .select("id")
        .eq("opportunity_slug", m.opportunity.slug)
        .eq("archived", false)
        .maybeSingle();
      if (existing) return existing.id;

      // Backend enforces the allowance (plan drafts first, then add-ons).
      await consumeProposalDraft();

      const { data, error } = await supabase
        .from("proposals")
        .insert({
          user_id: user.id,
          opportunity_id: m.opportunity.id,
          opportunity_slug: m.opportunity.slug,
          opportunity_title: m.opportunity.title,
          funder: m.opportunity.funder,
          deadline: m.opportunity.deadline,
          match_score: m.score,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (proposalId) => void navigate({ to: "/proposals/$id", params: { id: proposalId } }),
    onError: (e: Error) => {
      if (e.message === "DRAFT_LIMIT_REACHED") {
        setLimitOpen(true);
        return;
      }
      toast.error(e.message);
    },
  });


  const matches = useMemo(
    () => rankOpportunities(orgQuery.data ?? null, oppsQuery.data ?? []),
    [orgQuery.data, oppsQuery.data],
  );

  const geoCounts = useMemo(() => {
    const counts = new Map<GeoClassification, number>();
    for (const m of matches) counts.set(m.geo, (counts.get(m.geo) ?? 0) + 1);
    return counts;
  }, [matches]);

  const allowed = matchesRemaining === null ? matches : matches.slice(0, matchesRemaining + 0);
  const matchesCapped = matchesRemaining !== null && matches.length > allowed.length;

  const visible = allowed.filter((m) => {
    if (filter === "eligible" && !m.eligible) return false;
    if (filter === "saved" && !savedSlugs.has(m.opportunity.slug)) return false;
    if (geoFilter !== "any" && m.geo !== geoFilter) return false;

    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      m.opportunity.title.toLowerCase().includes(q) ||
      m.opportunity.funder.toLowerCase().includes(q) ||
      m.opportunity.focus_areas.join(" ").toLowerCase().includes(q)
    );
  });

  const loading = orgQuery.isLoading || oppsQuery.isLoading;

  useEffect(() => {
    if (!hasAccess || loading) return;
    void recordMatchesViewed(allowed.length);
  }, [hasAccess, loading, allowed.length, recordMatchesViewed]);

  return (
    <AppShell
      title="Funding matches"
      description="Scored against your organization profile. Every score shows exactly why it matched."
    >
      <SubscriptionGate loading={entLoading} hasAccess={hasAccess} feature="Funding matches">
      {strength && !canMatch && (
        <Card className="mb-6 border-accent/40 bg-accent/5">
          <CardContent className="p-5">
            <p className="text-sm font-bold text-foreground">
              Complete your profile to unlock opportunity matching
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your matches are built entirely from your Profile Intelligence. You&apos;re at{" "}
              {strength.score}% — matching turns on at 40%.
            </p>
            <ul className="mt-3 list-inside list-disc text-sm text-muted-foreground">
              {strength.topActions.map((a) => (
                <li key={a.label}>{a.label}</li>
              ))}
            </ul>
            <Button size="sm" className="mt-4" asChild>
              <Link to="/profile">Go to Profile Intelligence</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {strength && canMatch && strength.score < 80 && (
        <Card className="mb-6 border-border">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              These matches are based on a {strength.score}% complete profile.{" "}
              {strength.topActions[0]?.label ?? "Add more detail"} to surface more opportunities.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/profile">Improve profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {matchesCapped && (
        <Card className="mb-6 border-accent/40 bg-accent/5">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              You&apos;ve reached your plan&apos;s {formatLimit(limits.matches_per_month)} matches for this
              month. Upgrade to see every opportunity we found.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>Upgrade plan</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {!canSaveMore && limits.saved_opportunities_max !== null && (
        <Card className="mb-6 border-border">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              You&apos;ve saved {savedCount} of {formatLimit(limits.saved_opportunities_max)} opportunities.
              Remove one or upgrade to save more.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>Upgrade plan</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {orgQuery.data && !orgQuery.data.onboarding_complete && (
        <Card className="mb-6 border-accent/40 bg-accent/5">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              Your profile is incomplete — finishing it sharpens these scores considerably.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/onboarding">Complete profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title, funder or focus area"
            className="pl-9"
            aria-label="Search opportunities"
          />
        </div>
        <div className="inline-flex rounded-md border border-border bg-card p-1">
          {(
            [
              { id: "all", label: "All" },
              { id: "eligible", label: "Eligible" },
              { id: "saved", label: "Saved" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              aria-pressed={filter === t.id}
              className={cn(
                "rounded px-4 py-1.5 text-sm font-semibold transition-colors",
                filter === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Geographic coverage
        </span>
        {(
          ["any", "LOCAL", "HOME STATE", "REGIONAL", "NATIONAL", "TARGET MARKET", "OUT OF AREA"] as const
        ).map((g) => {
          const count = g === "any" ? matches.length : (geoCounts.get(g) ?? 0);
          return (
            <button
              key={g}
              onClick={() => setGeoFilter(g)}
              aria-pressed={geoFilter === g}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                geoFilter === g
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "any" ? "All areas" : GEO_LABEL[g]} ({count})
            </button>
          );
        })}
      </div>



      {loading ? (
        <p className="text-sm text-muted-foreground">Scoring opportunities…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">No opportunities match these filters yet.</p>
      ) : (
        <div className="space-y-4">
          {visible.map((m) => (
            <MatchCard
              key={m.opportunity.id}
              match={m}
              saved={savedSlugs.has(m.opportunity.slug)}
              onToggleSave={() => toggleSave.mutate(m.opportunity.slug)}
              onCreateProposal={() => createProposal.mutate(m)}
              creatingProposal={createProposal.isPending}
              tracked={trackedSlugs.has(m.opportunity.slug)}
              onAddToTracker={() => void addToTracker(m)}
            />

          ))}
        </div>
      )}
      <DraftLimitDialog
        open={limitOpen}
        onOpenChange={setLimitOpen}
        cycleEnd={cycleEnd}
        onPurchaseStarted={() => void refetchEntitlements()}
      />
    </SubscriptionGate>
    </AppShell>
  );
}

function MatchCard({
  match,
  saved,
  onToggleSave,
  onCreateProposal,
  creatingProposal,
  tracked,
  onAddToTracker,
}: {
  match: Match;
  saved: boolean;
  onToggleSave: () => void;
  onCreateProposal: () => void;
  creatingProposal: boolean;
  tracked: boolean;
  onAddToTracker: () => void;
}) {

  const { opportunity: o, score, reasons, eligible, daysLeft, geo, expansionNote, readiness } =
    match;

  return (
    <Card className={cn("shadow-soft", !eligible && "opacity-80")}>
      <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_200px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {o.funder_type}
            </Badge>
            <Badge variant="outline" className="border-primary/40 text-primary">
              {GEO_LABEL[geo]}
            </Badge>
            {o.opportunity_type !== "grant" && (
              <Badge variant="outline" className="capitalize">
                {o.opportunity_type}
              </Badge>
            )}
            {o.is_forecasted && (
              <Badge variant="outline" className="border-accent/50 text-accent-foreground">
                Forecasted
              </Badge>
            )}
            {!eligible && (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                Eligibility gap
              </Badge>
            )}
            {o.match_required && <Badge variant="outline">Match required</Badge>}
          </div>

          {expansionNote && (
            <p className="mt-3 rounded-md border border-accent/40 bg-accent/5 p-3 text-xs leading-relaxed text-muted-foreground">
              <strong className="text-foreground">Expansion opportunity — </strong>
              {expansionNote}
            </p>
          )}


          <h2 className="mt-3 text-lg font-bold text-foreground">{o.title}</h2>
          <p className="text-sm font-semibold text-muted-foreground">{o.funder}</p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{o.summary}</p>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatAward(o.award_min, o.award_max)}
            </span>
            {o.deadline && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="size-4" />
                {new Date(`${o.deadline}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {daysLeft !== null && daysLeft >= 0 && ` · ${daysLeft} days left`}
              </span>
            )}
            {o.source && <span>Source: {o.source}</span>}
          </div>

          <p className="mt-2 text-xs text-muted-foreground">
            Verified:{" "}
            {o.verified_at ? new Date(o.verified_at).toLocaleDateString() : "Pending verification"} ·
            Source type: {sourceTypeLabel(o.source_reliability)} · Authority {o.source_reliability}
            /100
          </p>


          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {reasons.map((r) => (
              <li key={r.label} className="flex gap-2 text-xs text-muted-foreground">
                {r.positive ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-accent" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                )}
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col justify-between gap-4 border-border md:border-l md:pl-6">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Match score
              </p>
              <p className="mt-1 text-4xl font-extrabold text-foreground">{score}</p>
              <Progress value={score} className="mt-2" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Application readiness
              </p>
              <p className="mt-1 text-2xl font-extrabold text-foreground">{readiness}</p>
              <Progress value={readiness} className="mt-2" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Button variant={saved ? "secondary" : "outline"} size="sm" onClick={onToggleSave}>
              {saved ? (
                <>
                  <BookmarkCheck className="mr-2 size-4" /> Saved
                </>
              ) : (
                <>
                  <Bookmark className="mr-2 size-4" /> Save
                </>
              )}
            </Button>
            <Button variant="hero" size="sm" onClick={onCreateProposal} disabled={creatingProposal}>
              {creatingProposal ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <FileText className="mr-2 size-4" />
              )}
              Create Draft Proposal
            </Button>
            <Button
              variant={tracked ? "secondary" : "outline"}
              size="sm"
              onClick={onAddToTracker}
              disabled={tracked}
            >
              <ListChecks className="mr-2 size-4" />
              {tracked ? "In Grant Tracker" : "Add to Tracker"}
            </Button>
            {score < 70 && (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Your match score for this opportunity is {score}%. You may still apply, but review
                eligibility carefully before investing time in a proposal.
              </p>
            )}
            {o.application_url && (
              <Button variant="outline" size="sm" asChild>
                <a href={o.application_url} target="_blank" rel="noreferrer noopener">
                  Apply on funder site <ExternalLink className="ml-2 size-4" />
                </a>
              </Button>
            )}

          </div>
        </div>
      </CardContent>
    </Card>
  );
}
