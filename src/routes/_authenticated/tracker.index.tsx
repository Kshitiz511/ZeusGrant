import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { SubscriptionGate } from "@/components/app/SubscriptionGate";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PipelineBoard } from "@/components/tracker/PipelineBoard";
import { TrackerSchedule } from "@/components/tracker/TrackerSchedule";
import { AwardsDashboard } from "@/components/tracker/AwardsDashboard";
import { StageMoveDialog } from "@/components/tracker/StageMoveDialog";
import { AddGrantDialog } from "@/components/tracker/AddGrantDialog";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useGrantTracker } from "@/hooks/useGrantTracker";
import { supabase } from "@/integrations/supabase/client";
import { pendingPrompt, trackerCapabilities, type GrantRecord, type GrantReportingItem } from "@/lib/tracker";

export const Route = createFileRoute("/_authenticated/tracker/")({
  head: () => ({
    meta: [
      { title: "Grant Tracker | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Track every grant from discovery to award: pipeline board, list and calendar views, plus an awards dashboard with win rate and funding analytics.",
      },
      { property: "og:title", content: "Grant Tracker | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Your organization's full grant portfolio — pipeline, deadlines, awards and win rate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TrackerPage,
});

function TrackerPage() {
  const { user } = useAuth();
  const { limits, isTrialing, hasAccess, loading: entLoading } = useEntitlements(user?.id);
  const { records, loading, addRecord, updateRecord, moveStage } = useGrantTracker(user?.id);
  const caps = trackerCapabilities(limits.plan_id, isTrialing);

  const [reporting, setReporting] = useState<GrantReportingItem[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [pending, setPending] = useState<{ record: GrantRecord; stage: string } | null>(null);
  const [orgName, setOrgName] = useState("");
  const [docCounts, setDocCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!user?.id) return;
    void (async () => {
      const [rep, org, docs] = await Promise.all([
        supabase.from("grant_reporting_items").select("*").eq("user_id", user.id),
        supabase.from("org_profiles").select("org_name").eq("user_id", user.id).maybeSingle(),
        supabase.from("grant_documents").select("grant_record_id").eq("user_id", user.id),
      ]);
      setReporting((rep.data as GrantReportingItem[]) ?? []);
      setOrgName(org.data?.org_name ?? "");
      const counts: Record<string, number> = {};
      for (const d of (docs.data ?? []) as { grant_record_id: string }[]) {
        counts[d.grant_record_id] = (counts[d.grant_record_id] ?? 0) + 1;
      }
      setDocCounts(counts);
    })();
  }, [user?.id]);

  const handleMove = (record: GrantRecord, toStage: string) => {
    if (toStage === "submitted" || toStage === "awarded") {
      setPending({ record, stage: toStage });
      return;
    }
    void moveStage(record, toStage).catch((e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Could not move the card"),
    );
  };

  const addNote = (record: GrantRecord) => {
    const note = window.prompt(`Add a note to ${record.grant_name}`);
    if (!note) return;
    const notes = record.internal_notes ? `${record.internal_notes}\n\n${note}` : note;
    void updateRecord(record.id, { internal_notes: notes }, `Note added: ${note.slice(0, 80)}`)
      .then(() => toast.success("Note saved."))
      .catch(() => toast.error("Could not save the note"));
  };

  const prompts = records.map((r) => ({ record: r, message: pendingPrompt(r) })).filter((p) => p.message);

  if (entLoading || loading) {
    return (
      <AppShell title="Grant Tracker">
        <Loader2 className="size-5 animate-spin text-primary" />
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell title="Grant Tracker" description="Track every grant from discovery through award.">
        <SubscriptionGate loading={false} hasAccess={false} feature="The Grant Tracker">
          <div />
        </SubscriptionGate>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="Grant Tracker"
      description="Your full grant portfolio — before, during and after submission."
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {records.length} grant{records.length === 1 ? "" : "s"} tracked
        </p>
        <Button variant="hero" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-2 size-4" /> Add grant
        </Button>
      </div>

      {prompts.length > 0 && (
        <div className="mb-6 space-y-2">
          {prompts.map(({ record, message }) => (
            <div
              key={record.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm"
            >
              <AlertCircle className="size-4 shrink-0 text-yellow-600" />
              <span className="text-foreground">{message}</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleMove(record, "submitted")}>
                  Mark submitted
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleMove(record, "withdrawn")}>
                  Withdrawn
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleMove(record, "under_review")}>
                  Under review
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Pipeline</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="awards">Awards dashboard</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-6">
          <PipelineBoard
            records={records}
            onMove={handleMove}
            onAddNote={addNote}
            onAdd={() => setAddOpen(true)}
            documentCounts={docCounts}
          />
        </TabsContent>
        <TabsContent value="calendar" className="mt-6">
          <TrackerSchedule
            records={records}
            reporting={reporting}
            canExport={limits.calendar_export}
          />
        </TabsContent>
        <TabsContent value="awards" className="mt-6">
          <AwardsDashboard
            records={records}
            canExportPdf={caps.pdfReport}
            whiteLabel={caps.whiteLabelReport}
            orgName={orgName}
          />
        </TabsContent>
      </Tabs>

      <AddGrantDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreate={async (input) => {
          try {
            await addRecord(input);
            toast.success("Added to your tracker.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not add the grant");
          }
        }}
      />

      <StageMoveDialog
        record={pending?.record ?? null}
        toStage={pending?.stage ?? null}
        onCancel={() => setPending(null)}
        onConfirm={async (patch) => {
          if (!pending) return;
          try {
            await moveStage(pending.record, pending.stage, patch);
            toast.success("Stage updated.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not update the stage");
          } finally {
            setPending(null);
          }
        }}
      />
    </AppShell>
  );
}
