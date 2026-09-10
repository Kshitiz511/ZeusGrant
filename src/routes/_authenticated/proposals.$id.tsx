import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  History,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import {
  AI_DISCLAIMER,
  completenessScore,
  downloadBlob,
  pageCount,
  printHtml,
  proposalFileName,
  proposalHtml,
  wordCount,
  type ComplianceResults,
  type DraftSection,
  type EligibilityItem,
  type InterviewSection,
  type ProposalRow,
} from "@/lib/proposals";
import {
  buildProposalPlan,
  generateProposalDraft,
  reviseProposalSection,
  runComplianceReview,
} from "@/utils/proposals.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/proposals/$id")({
  head: () => ({
    meta: [
      { title: "Proposal workspace — ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Guided grant proposal interview, AI draft generation, in-app editing, compliance review and export.",
      },
      { property: "og:title", content: "Proposal workspace — ZCS GrantMatch Innovation" },
      { property: "og:description", content: "Build a submission-ready grant proposal draft." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProposalWorkspace,
});

type Phase = "eligibility" | "interview" | "draft" | "compliance";

function ProposalWorkspace() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    hasAccess,
    loading: entLoading,
    proposals: caps,
    logProposalEvent,
  } = useEntitlements(user?.id);

  const buildPlan = useServerFn(buildProposalPlan);
  const genDraft = useServerFn(generateProposalDraft);
  const revise = useServerFn(reviseProposalSection);
  const compliance = useServerFn(runComplianceReview);

  const proposalQuery = useQuery({
    queryKey: ["proposal", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("proposals").select("*").eq("id", id).single();
      if (error) throw error;
      return data as ProposalRow;
    },
  });

  const orgQuery = useQuery({
    queryKey: ["org-profile"],
    queryFn: async () => {
      const { data, error } = await supabase.from("org_profiles").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const proposal = proposalQuery.data;

  const oppQuery = useQuery({
    queryKey: ["opportunity", proposal?.opportunity_slug],
    enabled: !!proposal?.opportunity_slug,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("*")
        .eq("slug", proposal!.opportunity_slug)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sectionsPlan = (proposal?.interview_plan ?? []) as unknown as InterviewSection[];
  const eligibility = (proposal?.eligibility_checklist ?? []) as unknown as EligibilityItem[];
  const draft = (proposal?.draft_content ?? []) as unknown as DraftSection[];
  const answers = (proposal?.interview_answers ?? {}) as Record<string, string>;
  const complianceResults = proposal?.compliance_review_results as unknown as ComplianceResults | null;

  const [phase, setPhase] = useState<Phase>("eligibility");
  const [building, setBuilding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");

  useEffect(() => {
    if (!proposal) return;
    if (draft.length) setPhase(complianceResults ? "compliance" : "draft");
    else if (sectionsPlan.length && proposal.interview_position > 0) setPhase("interview");
  }, [proposal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(
    async (patch: Partial<ProposalRow>) => {
      const { error } = await supabase.from("proposals").update(patch).eq("id", id);
      if (error) {
        toast.error(error.message);
        return false;
      }
      await qc.invalidateQueries({ queryKey: ["proposal", id] });
      return true;
    },
    [id, qc],
  );

  // Build the grant-specific interview the first time the workspace opens.
  useEffect(() => {
    if (!proposal || sectionsPlan.length || building || !oppQuery.data) return;
    setBuilding(true);
    void (async () => {
      try {
        const result = await buildPlan({
          data: {
            opportunity: oppQuery.data as Record<string, unknown>,
            org: (orgQuery.data ?? null) as Record<string, unknown> | null,
            matchScore: proposal.match_score ?? 0,
          },
        });
        await save({
          eligibility_checklist: result.eligibility as never,
          interview_plan: result.sections as never,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not prepare the interview.");
      } finally {
        setBuilding(false);
      }
    })();
  }, [proposal?.id, oppQuery.data, orgQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (!oppQuery.data) return;
    setGenerating(true);
    setGenStatus("Analyzing grant requirements…");
    try {
      setTimeout(() => setGenStatus("Drafting sections…"), 1500);
      setTimeout(() => setGenStatus("Formatting document…"), 6000);
      const result = await genDraft({
        data: {
          opportunity: oppQuery.data as Record<string, unknown>,
          org: (orgQuery.data ?? null) as Record<string, unknown> | null,
          sections: sectionsPlan,
          answers,
        },
      });
      const score = completenessScore(result.sections);
      await save({
        draft_content: result.sections as never,
        completeness_score: score,
        status: "draft_generated",
      });
      setPhase("draft");
      toast.success(`Draft generated — ${score}% complete`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Draft generation failed.");
    } finally {
      setGenerating(false);
      setGenStatus("");
    }
  }

  if (entLoading || proposalQuery.isLoading) {
    return (
      <AppShell title="Proposal workspace">
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  if (!proposal) {
    return (
      <AppShell title="Proposal workspace">
        <p className="text-sm text-muted-foreground">This proposal could not be found.</p>
        <Button className="mt-4" variant="outline" asChild>
          <Link to="/proposals">Back to My Proposals</Link>
        </Button>
      </AppShell>
    );
  }

  return (
    <AppShell title={proposal.opportunity_title} description={`${proposal.funder} · proposal workspace`}>
      <SubscriptionGate loading={false} hasAccess={hasAccess} feature="Proposal drafting">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/proposals">
              <ArrowLeft className="mr-2 size-4" /> My Proposals
            </Link>
          </Button>
          {(["eligibility", "interview", "draft", "compliance"] as Phase[]).map((p) => (
            <button
              key={p}
              onClick={() => setPhase(p)}
              disabled={(p === "draft" || p === "compliance") && !draft.length}
              aria-pressed={phase === p}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors disabled:opacity-40",
                phase === p
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "eligibility" ? "Eligibility" : p === "interview" ? "Interview" : p === "draft" ? "Draft & editing" : "Compliance & export"}
            </button>
          ))}
        </div>

        {generating && (
          <Card className="mb-6 border-primary/40 bg-primary/5">
            <CardContent className="flex items-center gap-3 p-5">
              <Loader2 className="size-5 animate-spin text-primary" />
              <p className="text-sm font-semibold text-foreground">
                Building your proposal… {genStatus}
              </p>
            </CardContent>
          </Card>
        )}

        {phase === "eligibility" && (
          <EligibilityStep
            building={building}
            items={eligibility}
            matchScore={proposal.match_score ?? 0}
            onContinue={() => setPhase("interview")}
          />
        )}

        {phase === "interview" && (
          <InterviewStep
            sections={sectionsPlan}
            answers={answers}
            position={proposal.interview_position}
            building={building}
            onSave={save}
            onGenerate={generate}
            generating={generating}
          />
        )}

        {phase === "draft" && (
          <DraftEditor
            proposal={proposal}
            sections={draft}
            opportunity={oppQuery.data as Record<string, unknown> | undefined}
            revise={revise}
            onSave={save}
            onCompliance={() => setPhase("compliance")}
            canRevise={caps.canReviseSections}
            onUpgrade={() => void navigate({ to: "/billing", search: { plan: undefined, annual: false, checkout: undefined } })}
          />
        )}

        {phase === "compliance" && (
          <ComplianceStep
            proposal={proposal}
            sections={draft}
            org={orgQuery.data}
            opportunity={oppQuery.data as Record<string, unknown> | undefined}
            results={complianceResults}
            level={caps.complianceLevel}
            canExport={caps.canExport}
            canUseTemplates={caps.canUseTemplates}
            canWhiteLabel={caps.canWhiteLabel}
            logEvent={logProposalEvent}
            userId={user?.id}
            runReview={compliance}
            onSave={save}
            onUpgrade={() => void navigate({ to: "/billing", search: { plan: undefined, annual: false, checkout: undefined } })}
          />
        )}
      </SubscriptionGate>
    </AppShell>
  );
}

/* ---------------------------------- Step 2 --------------------------------- */

function EligibilityStep({
  building,
  items,
  matchScore,
  onContinue,
}: {
  building: boolean;
  items: EligibilityItem[];
  matchScore: number;
  onContinue: () => void;
}) {
  const hasIssue = items.some((i) => i.state === "issue");

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-xl font-bold text-foreground">Before we build your proposal</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every hard eligibility requirement for this grant, checked against your organization profile.
        </p>

        {matchScore < 70 && (
          <p className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm text-muted-foreground">
            Your match score for this opportunity is {matchScore}%. You may still apply, but review
            eligibility carefully before investing time in a proposal.
          </p>
        )}

        {building ? (
          <div className="flex items-center gap-3 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-primary" /> Reading the solicitation and checking
            your profile…
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {items.map((item) => (
              <li key={item.label} className="flex gap-3 rounded-md border border-border p-3">
                {item.state === "confirmed" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />
                ) : item.state === "verify" ? (
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                )}
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.state === "confirmed"
                      ? "Confirmed from your profile — no action needed. "
                      : item.state === "verify"
                        ? "Needs verification — we'll ask you about this. "
                        : "Potential issue — review before submitting. "}
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasIssue && (
          <p className="mt-5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-semibold text-destructive">
            One or more eligibility requirements may not be met.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="hero" onClick={onContinue} disabled={building}>
            Continue to Proposal Interview <ArrowRight className="ml-2 size-4" />
          </Button>
          <Button variant="outline" asChild>
            <Link to="/proposals">Save for Later</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------- Step 3 --------------------------------- */

function InterviewStep({
  sections,
  answers,
  position,
  building,
  onSave,
  onGenerate,
  generating,
}: {
  sections: InterviewSection[];
  answers: Record<string, string>;
  position: number;
  building: boolean;
  onSave: (patch: Partial<ProposalRow>) => Promise<boolean>;
  onGenerate: () => void;
  generating: boolean;
}) {
  const flat = useMemo(
    () => sections.flatMap((s, si) => s.questions.map((q) => ({ ...q, section: s, sectionIndex: si }))),
    [sections],
  );
  const [index, setIndex] = useState(Math.min(position, Math.max(0, flat.length - 1)));
  const current = flat[index];
  const [value, setValue] = useState(current ? (answers[current.id] ?? "") : "");

  useEffect(() => {
    setValue(current ? (answers[current.id] ?? "") : "");
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (building || !current) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-10 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" /> Preparing questions for this grant…
        </CardContent>
      </Card>
    );
  }

  const answered = flat.filter((q) => (answers[q.id] ?? "").trim()).length;
  const progress = Math.round((answered / flat.length) * 100);
  const minutesLeft = Math.max(1, Math.round((flat.length - answered) * 1.5));

  async function persist(next: string, moveTo: number) {
    const merged = { ...answers, [current!.id]: next };
    const complete = flat.every((q) => !q.required || (merged[q.id] ?? "").trim());
    await onSave({
      interview_answers: merged as never,
      interview_position: moveTo,
      status: complete ? "interview_complete" : "in_progress",
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Section {current.sectionIndex + 1} of {sections.length} — {current.section.title}
            </p>
            <p className="text-xs text-muted-foreground">
              {answered}/{flat.length} answered · ~{minutesLeft} min left
            </p>
          </div>
          <Progress value={progress} className="mt-3" />

          <div className="mt-6 flex items-start gap-2">
            <h2 className="text-lg font-bold text-foreground">{current.prompt}</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    aria-label="Why is this being asked?"
                    className="mt-1 rounded-full border border-border px-2 text-xs font-bold text-muted-foreground"
                  >
                    ?
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{current.why}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{current.section.purpose}</p>

          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void persist(value, index)}
            rows={9}
            className="mt-4"
            placeholder="Answer in your own words — detail helps the draft."
            aria-label={current.prompt}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            {current.prefill && (
              <Button variant="outline" size="sm" onClick={() => setValue(current.prefill!)}>
                <Sparkles className="mr-2 size-4" /> Use my profile data
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await persist(value, index);
                toast.success("Saved");
              }}
            >
              <Save className="mr-2 size-4" /> Save
            </Button>
            {!current.required && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await persist("", Math.min(index + 1, flat.length - 1));
                  setIndex((i) => Math.min(i + 1, flat.length - 1));
                }}
              >
                Skip for now
              </Button>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <Button
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={async () => {
                await persist(value, index - 1);
                setIndex((i) => Math.max(0, i - 1));
              }}
            >
              <ArrowLeft className="mr-2 size-4" /> Back
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onGenerate} disabled={generating}>
                <FileText className="mr-2 size-4" /> Generate Draft Now
              </Button>
              {index < flat.length - 1 ? (
                <Button
                  variant="hero"
                  size="sm"
                  onClick={async () => {
                    await persist(value, index + 1);
                    setIndex((i) => i + 1);
                  }}
                >
                  Next <ArrowRight className="ml-2 size-4" />
                </Button>
              ) : (
                <Button
                  variant="hero"
                  size="sm"
                  onClick={async () => {
                    await persist(value, index);
                    onGenerate();
                  }}
                  disabled={generating}
                >
                  Finish and generate <Sparkles className="ml-2 size-4" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Answers auto-save — you can leave and come back.</p>
    </div>
  );
}

/* --------------------------------- Step 5 ---------------------------------- */

function DraftEditor({
  proposal,
  sections,
  opportunity,
  revise,
  onSave,
  onCompliance,
  canRevise,
  onUpgrade,
}: {
  proposal: ProposalRow;
  sections: DraftSection[];
  opportunity: Record<string, unknown> | undefined;
  canRevise: boolean;
  onUpgrade: () => void;
  revise: (args: {
    data: {
      opportunity: Record<string, unknown>;
      section: DraftSection;
      mode: "rewrite" | "expand" | "shorten" | "check";
      instruction?: string;
    };
  }) => Promise<{ content: string; notes: string }>;
  onSave: (patch: Partial<ProposalRow>) => Promise<boolean>;
  onCompliance: () => void;
}) {
  const [local, setLocal] = useState<DraftSection[]>(sections);
  const [busy, setBusy] = useState<string | null>(null);
  const [instruction, setInstruction] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showHistory, setShowHistory] = useState(false);
  const dirty = useRef(false);

  const history = (proposal.version_history ?? []) as unknown as {
    saved_at: string;
    sections: DraftSection[];
  }[];

  const persist = useCallback(
    async (next: DraftSection[], snapshot = false) => {
      const patch: Partial<ProposalRow> = {
        draft_content: next as never,
        completeness_score: completenessScore(next),
      };
      if (snapshot) {
        const entry = { saved_at: new Date().toISOString(), sections: local };
        patch.version_history = [entry, ...history].slice(0, 10) as never;
      }
      await onSave(patch);
      dirty.current = false;
    },
    [history, local, onSave],
  );

  // Auto-save every 30 seconds.
  useEffect(() => {
    const t = setInterval(() => {
      if (dirty.current) void persist(local);
    }, 30_000);
    return () => clearInterval(t);
  }, [local, persist]);

  function update(id: string, content: string) {
    dirty.current = true;
    setLocal((prev) => prev.map((s) => (s.id === id ? { ...s, content } : s)));
  }

  async function act(section: DraftSection, mode: "rewrite" | "expand" | "shorten" | "check") {
    setBusy(`${section.id}:${mode}`);
    try {
      const result = await revise({
        data: {
          opportunity: opportunity ?? {},
          section: local.find((s) => s.id === section.id) ?? section,
          mode,
          ...(mode === "rewrite" ? { instruction: instruction[section.id] ?? "" } : {}),
        },
      });
      if (mode === "check") {
        setNotes((n) => ({ ...n, [section.id]: result.notes }));
      } else {
        const next = local.map((s) =>
          s.id === section.id ? { ...s, content: result.content, source: "ai" as const } : s,
        );
        setLocal(next);
        await persist(next, true);
        toast.success("Section updated");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The AI request failed.");
    } finally {
      setBusy(null);
    }
  }

  const score = completenessScore(local);

  return (
    <div className="space-y-4">
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Proposal completeness
            </p>
            <p className="text-3xl font-extrabold text-foreground">{score}%</p>
            <p className="text-xs text-muted-foreground">
              {wordCount(local).toLocaleString()} words · ~{pageCount(local)} pages · auto-saves every 30s
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowHistory((v) => !v)}>
              <History className="mr-2 size-4" /> Version history ({history.length})
            </Button>
            <Button variant="outline" size="sm" onClick={() => void persist(local, true)}>
              <Save className="mr-2 size-4" /> Save version
            </Button>
            <Button variant="hero" size="sm" onClick={async () => { await persist(local); onCompliance(); }}>
              <ShieldCheck className="mr-2 size-4" /> Compliance check
            </Button>
          </div>
        </CardContent>
      </Card>

      {showHistory && (
        <Card>
          <CardContent className="p-5">
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved versions yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.map((v) => (
                  <li key={v.saved_at} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {new Date(v.saved_at).toLocaleString()}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        setLocal(v.sections);
                        await persist(v.sections);
                        toast.success("Reverted to that version");
                      }}
                    >
                      Revert
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {local.map((section) => {
        const hasPlaceholder = /\[INFORMATION NEEDED/i.test(section.content);
        return (
          <Card
            key={section.id}
            className={cn(
              hasPlaceholder && "border-destructive/50",
              !hasPlaceholder && section.source === "profile" && "border-primary/50",
            )}
          >
            <CardContent className="grid gap-6 p-6 lg:grid-cols-[1fr_260px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-foreground">{section.title}</h2>
                  {hasPlaceholder && (
                    <Badge variant="outline" className="border-destructive/50 text-destructive">
                      Needs information
                    </Badge>
                  )}
                  {!hasPlaceholder && section.source === "profile" && (
                    <Badge variant="outline" className="border-primary/50 text-primary">
                      Pre-filled from your profile — review and confirm
                    </Badge>
                  )}
                </div>
                <Textarea
                  value={section.content}
                  onChange={(e) => update(section.id, e.target.value)}
                  onBlur={() => void persist(local)}
                  rows={14}
                  className="mt-3 font-serif text-[15px] leading-relaxed"
                  aria-label={`${section.title} content`}
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  {section.content.trim().split(/\s+/).filter(Boolean).length} words
                </p>

                {!canRevise && (
                  <p className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                    AI section tools (rewrite, expand, shorten, requirement check) are available on
                    Growth and above. You can still edit every section by hand.{" "}
                    <button className="font-semibold text-primary underline" onClick={onUpgrade}>
                      Upgrade
                    </button>
                  </p>
                )}
                <div className={canRevise ? "mt-3 flex flex-wrap gap-2" : "hidden"}>
                  <Input
                    value={instruction[section.id] ?? ""}
                    onChange={(e) =>
                      setInstruction((i) => ({ ...i, [section.id]: e.target.value }))
                    }
                    placeholder="Rewrite instruction (e.g. more emphasis on community impact)"
                    className="min-w-[240px] flex-1"
                    aria-label={`Rewrite instruction for ${section.title}`}
                  />
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(section, "rewrite")}>
                    {busy === `${section.id}:rewrite` ? (
                      <Loader2 className="mr-2 size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 size-4" />
                    )}
                    Rewrite this section
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(section, "expand")}>
                    <Maximize2 className="mr-2 size-4" /> Expand
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(section, "shorten")}>
                    <Minimize2 className="mr-2 size-4" /> Shorten
                  </Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void act(section, "check")}>
                    <ClipboardCheck className="mr-2 size-4" /> Check against requirements
                  </Button>
                </div>

                {notes[section.id] && (
                  <p className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                    {notes[section.id]}
                  </p>
                )}
              </div>

              <aside className="rounded-md border border-border bg-muted/30 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  What the funder asked for
                </p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{section.requirement}</p>
              </aside>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------- Steps 6 & 7 -------------------------------- */

function ComplianceStep({
  proposal,
  sections,
  org,
  opportunity,
  results,
  level,
  canExport,
  canUseTemplates,
  canWhiteLabel,
  logEvent,
  userId,
  runReview,
  onSave,
  onUpgrade,
}: {
  proposal: ProposalRow;
  sections: DraftSection[];
  org: { org_name?: string | null } | null | undefined;
  opportunity: Record<string, unknown> | undefined;
  results: ComplianceResults | null;
  level: "basic" | "full" | "full_ai";
  canExport: boolean;
  canUseTemplates: boolean;
  canWhiteLabel: boolean;
  logEvent: (event: string, metadata?: Record<string, unknown>, proposalId?: string) => Promise<void>;
  userId: string | undefined;
  runReview: (args: {
    data: {
      opportunity: Record<string, unknown>;
      org: Record<string, unknown> | null;
      sections: DraftSection[];
      level: "basic" | "full" | "full_ai";
    };
  }) => Promise<ComplianceResults>;
  onSave: (patch: Partial<ProposalRow>) => Promise<boolean>;
  onUpgrade: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [clientName, setClientName] = useState("");
  const orgName = (canWhiteLabel && clientName.trim()) || org?.org_name || "Organization";

  async function run() {
    setRunning(true);
    try {
      const res = await runReview({
        data: {
          opportunity: opportunity ?? {},
          org: (org ?? null) as Record<string, unknown> | null,
          sections,
          level,
        },
      });
      await onSave({
        compliance_review_results: res as never,
        status: "compliance_reviewed",
      });
      toast.success("Compliance review complete");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Compliance review failed.");
    } finally {
      setRunning(false);
    }
  }

  function html(extraSections?: { title: string; content: string }[]) {
    return proposalHtml({
      title: proposal.opportunity_title,
      funder: proposal.funder,
      orgName,
      sections: extraSections ?? sections.map((s) => ({ title: s.title, content: s.content })),
    });
  }

  async function markDownloaded(format: string) {
    await onSave({ status: "downloaded", downloaded_at: new Date().toISOString() });
    await logEvent("proposal.exported", { format, white_label: !!clientName.trim() }, proposal.id);
  }

  async function saveTemplate() {
    if (!userId) return;
    const { error } = await supabase.from("proposal_templates").insert({
      user_id: userId,
      name: `${proposal.funder} — ${proposal.opportunity_title}`,
      source_proposal_id: proposal.id,
      interview_answers: proposal.interview_answers,
      draft_content: proposal.draft_content,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved as a reusable template");
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <h2 className="text-xl font-bold text-foreground">Proposal Compliance Review</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {level === "basic"
              ? "Basic review on your plan — upgrade for the full compliance matrix and AI evaluation-criteria review."
              : level === "full"
                ? "Full compliance review on your plan."
                : "Full compliance review with AI evaluation-criteria analysis."}
          </p>

          <Button className="mt-4" variant="hero" onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-2 size-4 animate-spin" /> : <ShieldCheck className="mr-2 size-4" />}
            {results ? "Re-run review" : "Run compliance review"}
          </Button>

          {results && (
            <ul className="mt-6 space-y-2">
              {results.items.map((item) => (
                <li key={item.label} className="flex gap-3 rounded-md border border-border p-3">
                  {item.state === "pass" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />
                  ) : item.state === "warn" ? (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-6 rounded-md border border-accent/40 bg-accent/5 p-3 text-xs leading-relaxed text-foreground">
            {AI_DISCLAIMER}
          </p>

          {results && (
            <label className="mt-4 flex items-start gap-3 text-sm text-muted-foreground">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={(v) => setAcknowledged(v === true)}
                aria-label="Acknowledge compliance review"
              />
              I have reviewed the compliance results and accept responsibility for the final content.
            </label>
          )}
        </CardContent>
      </Card>

      {results && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-bold text-foreground">Download and export</h2>
            {!canExport && (
              <p className="mt-2 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                Your plan includes in-app preview only. Upgrade to Growth or above to export DOCX and PDF.{" "}
                <button className="font-semibold text-primary underline" onClick={onUpgrade}>
                  Upgrade
                </button>
              </p>
            )}
            {canWhiteLabel && (
              <div className="mt-4">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  White-labeled export — client name
                </label>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client organization name (defaults to your organization)"
                  className="mt-1 max-w-md"
                />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="hero"
                size="sm"
                disabled={!canExport || !acknowledged}
                onClick={async () => {
                  downloadBlob(
                    html(),
                    proposalFileName(orgName, proposal.opportunity_title, "docx"),
                    "application/msword",
                  );
                  await markDownloaded("docx");
                }}
              >
                <Download className="mr-2 size-4" /> Download DOCX
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!canExport || !acknowledged}
                onClick={async () => {
                  printHtml(html());
                  await markDownloaded("pdf");
                }}
              >
                <Download className="mr-2 size-4" /> Download PDF
              </Button>
              {results.budget_narrative && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canExport || !acknowledged}
                  onClick={() =>
                    downloadBlob(
                      html([{ title: "Budget Narrative", content: results.budget_narrative! }]),
                      proposalFileName(orgName, `${proposal.opportunity_title} Budget Narrative`, "docx"),
                      "application/msword",
                    )
                  }
                >
                  Budget narrative
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!canExport || !acknowledged}
                onClick={() =>
                  downloadBlob(
                    html([
                      {
                        title: "Attachments Checklist",
                        content: results.attachments.map((a) => `[ ] ${a}`).join("\n\n"),
                      },
                      { title: "Submission Instructions Summary", content: results.submission_summary },
                    ]),
                    proposalFileName(orgName, `${proposal.opportunity_title} Submission Pack`, "docx"),
                    "application/msword",
                  )
                }
              >
                Attachments + submission guide
              </Button>
              {canUseTemplates && (
                <Button variant="outline" size="sm" onClick={saveTemplate}>
                  Save as template
                </Button>
              )}
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Attachments checklist
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {results.attachments.map((a) => (
                    <li key={a}>☐ {a}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Submission instructions
                </p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {results.submission_summary}
                </p>
              </div>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <p className="text-sm font-semibold text-foreground">
                Have a grant writing expert review your proposal
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional paid add-on. A human reviewer reads your draft and returns line-level feedback
                before you submit.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => toast.success("Review requested — our team will contact you by email.")}
              >
                Request expert review
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
