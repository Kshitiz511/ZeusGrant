import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, Download, FileText, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { DraftLimitDialog } from "@/components/app/DraftLimitDialog";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { PROPOSAL_STATUS_LABEL, type ProposalRow } from "@/lib/proposals";
import { daysUntil } from "@/lib/matching";

export const Route = createFileRoute("/_authenticated/proposals/")({
  head: () => ({
    meta: [
      { title: "My Proposals — ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Track every grant proposal draft: interview progress, completeness score, deadlines and exports.",
      },
      { property: "og:title", content: "My Proposals — ZCS GrantMatch Innovation" },
      { property: "og:description", content: "Manage your AI-assisted grant proposal drafts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProposalsPage,
});

function ProposalsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const {
    hasAccess,
    loading,
    proposals: caps,
    draftsRemaining,
    addonDraftsRemaining,
    cycleEnd,
    consumeProposalDraft,
    refetch: refetchEntitlements,
  } = useEntitlements(user?.id);
  const [limitOpen, setLimitOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ["proposals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposals")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as ProposalRow[];
    },
  });

  const rows = listQuery.data ?? [];
  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);

  async function archive(row: ProposalRow) {
    const { error } = await supabase
      .from("proposals")
      .update({ archived: !row.archived })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["proposals"] });
  }

  async function duplicate(row: ProposalRow) {
    if (!user) return;
    if (!caps.canDuplicate) {
      toast.error("Duplicating proposals is available on Growth and above.");
      return;
    }
    // A duplicate is a new draft, so it consumes the cycle allowance.
    try {
      await consumeProposalDraft();
    } catch (e) {
      if ((e as Error).message === "DRAFT_LIMIT_REACHED") {
        setLimitOpen(true);
        return;
      }
      toast.error((e as Error).message);
      return;
    }
    const { data, error } = await supabase
      .from("proposals")
      .insert({
        user_id: user.id,
        opportunity_id: row.opportunity_id,
        opportunity_slug: row.opportunity_slug,
        opportunity_title: row.opportunity_title,
        funder: row.funder,
        deadline: row.deadline,
        match_score: row.match_score,
        status: "in_progress",
        eligibility_checklist: row.eligibility_checklist,
        interview_plan: row.interview_plan,
        interview_answers: row.interview_answers,
        draft_content: row.draft_content,
        completeness_score: row.completeness_score,
      })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Copied — answers carried over.");
    void navigate({ to: "/proposals/$id", params: { id: data.id } });
  }

  return (
    <AppShell
      title="My Proposals"
      description="Every draft you have started, with completeness, deadlines and export status."
    >
      <SubscriptionGate loading={loading} hasAccess={hasAccess} feature="Proposal drafting">
        <DraftLimitDialog
          open={limitOpen}
          onOpenChange={setLimitOpen}
          cycleEnd={cycleEnd}
          onPurchaseStarted={() => void refetchEntitlements()}
        />
        <Card className="mb-6 border-border">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">
              {draftsRemaining === null
                ? "Unlimited proposal drafts on your plan."
                : draftsRemaining > 0
                  ? `${draftsRemaining} proposal draft${draftsRemaining === 1 ? "" : "s"} left this billing cycle.`
                  : `You've used all your proposal drafts for this billing cycle. Your next drafts will be available on ${new Date(
                      `${cycleEnd}T00:00:00Z`,
                    ).toLocaleDateString()}. Existing drafts stay editable.`}
              {addonDraftsRemaining > 0 && ` Includes ${addonDraftsRemaining} add-on draft${addonDraftsRemaining === 1 ? "" : "s"}.`}
              {!caps.canExport && " Exports (DOCX/PDF) unlock on Growth and above."}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/opportunities">
                <Plus className="mr-2 size-4" /> Start from an opportunity
              </Link>
            </Button>
          </CardContent>
        </Card>

        {listQuery.isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : active.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
              <FileText className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No proposals yet. Open a match and choose &ldquo;Create Draft Proposal&rdquo;.
              </p>
              <Button variant="hero" asChild>
                <Link to="/opportunities">Browse matches</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {active.map((row) => (
              <ProposalCard key={row.id} row={row} onArchive={archive} onDuplicate={duplicate} />
            ))}
          </div>
        )}

        {caps.canUseTemplates && <TemplateLibrary proposals={active} />}

        {archived.length > 0 && (
          <>

            <h2 className="mb-3 mt-10 text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Archived
            </h2>
            <div className="space-y-4 opacity-70">
              {archived.map((row) => (
                <ProposalCard key={row.id} row={row} onArchive={archive} onDuplicate={duplicate} />
              ))}
            </div>
          </>
        )}
      </SubscriptionGate>
    </AppShell>
  );
}

function ProposalCard({
  row,
  onArchive,
  onDuplicate,
}: {
  row: ProposalRow;
  onArchive: (row: ProposalRow) => void;
  onDuplicate: (row: ProposalRow) => void;
}) {
  const left = daysUntil(row.deadline);
  return (
    <Card className="shadow-soft">
      <CardContent className="grid gap-6 p-6 md:grid-cols-[1fr_220px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{PROPOSAL_STATUS_LABEL[row.status] ?? row.status}</Badge>
            {row.deadline && (
              <Badge variant="outline" className={left !== null && left < 14 ? "border-destructive/50 text-destructive" : ""}>
                Due {new Date(`${row.deadline}T00:00:00`).toLocaleDateString()}
                {left !== null && left >= 0 && ` · ${left} days left`}
              </Badge>
            )}
          </div>
          <h2 className="mt-3 text-lg font-bold text-foreground">{row.opportunity_title}</h2>
          <p className="text-sm font-semibold text-muted-foreground">{row.funder}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Last edited {new Date(row.updated_at).toLocaleString()}
            {row.downloaded_at && ` · Downloaded ${new Date(row.downloaded_at).toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex flex-col justify-between gap-4 border-border md:border-l md:pl-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Completeness
            </p>
            <p className="mt-1 text-3xl font-extrabold text-foreground">{row.completeness_score}%</p>
            <Progress value={row.completeness_score} className="mt-2" />
          </div>
          <div className="flex flex-col gap-2">
            <Button variant="hero" size="sm" asChild>
              <Link to="/proposals/$id" params={{ id: row.id }}>
                <Download className="mr-2 size-4" /> Continue
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onDuplicate(row)}>
                <Copy className="mr-2 size-4" /> Duplicate
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => onArchive(row)}>
                <Archive className="mr-2 size-4" /> {row.archived ? "Restore" : "Archive"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

type TemplateRow = {
  id: string;
  name: string;
  created_at: string;
  interview_answers: unknown;
  draft_content: unknown;
};

/**
 * Saved proposal templates (Professional and above): reuse a previous
 * proposal's interview answers and narrative on another draft.
 */
function TemplateLibrary({ proposals }: { proposals: ProposalRow[] }) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<Record<string, string>>({});

  const templates = useQuery({
    queryKey: ["proposal_templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_templates")
        .select("id,name,created_at,interview_answers,draft_content")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as TemplateRow[];
    },
  });

  async function remove(id: string) {
    const { error } = await supabase.from("proposal_templates").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["proposal_templates"] });
  }

  async function apply(tpl: TemplateRow) {
    const proposalId = target[tpl.id];
    if (!proposalId) {
      toast.error("Choose the draft to apply this template to.");
      return;
    }
    const { error } = await supabase
      .from("proposals")
      .update({
        interview_answers: tpl.interview_answers as never,
        draft_content: tpl.draft_content as never,
      })
      .eq("id", proposalId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Template applied — review the draft before exporting.");
    void qc.invalidateQueries({ queryKey: ["proposals"] });
  }

  const rows = templates.data ?? [];

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
        Proposal templates
      </h2>
      <Card>
        <CardContent className="space-y-3 p-5">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No templates yet. Open a proposal and choose &ldquo;Save as template&rdquo; to reuse its
              answers and narrative later.
            </p>
          )}
          {rows.map((tpl) => (
            <div key={tpl.id} className="flex flex-wrap items-center gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{tpl.name}</p>
                <p className="text-xs text-muted-foreground">
                  Saved {new Date(tpl.created_at).toLocaleDateString()}
                </p>
              </div>
              <select
                aria-label={`Apply ${tpl.name} to a draft`}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={target[tpl.id] ?? ""}
                onChange={(e) => setTarget({ ...target, [tpl.id]: e.target.value })}
              >
                <option value="">Choose a draft…</option>
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.opportunity_title}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => void apply(tpl)}>
                Apply
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void remove(tpl.id)}>
                Delete
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
