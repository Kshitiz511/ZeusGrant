import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { supabase } from "@/integrations/supabase/client";
import {
  DOCUMENT_TYPES,
  STAGES,
  STAGE_LABEL,
  TEAM_ROLES,
  formatDate,
  formatMoney,
  trackerCapabilities,
  type GrantActivity,
  type GrantDocument,
  type GrantRecord,
  type GrantReportingItem,
  type GrantStageHistory,
  type GrantTeamMember,
} from "@/lib/tracker";

export const Route = createFileRoute("/_authenticated/tracker/$id")({
  head: () => ({
    meta: [
      { title: "Grant record | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "Full record for a tracked grant: stage history, proposal link, activity log, documents, reporting schedule and team assignments.",
      },
      { property: "og:title", content: "Grant record | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Stage history, documents, reporting schedule and team for a tracked grant.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: GrantRecordPage,
});

function GrantRecordPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { limits, isTrialing } = useEntitlements(user?.id);
  const caps = trackerCapabilities(limits.plan_id, isTrialing);

  const [record, setRecord] = useState<GrantRecord | null>(null);
  const [history, setHistory] = useState<GrantStageHistory[]>([]);
  const [activity, setActivity] = useState<GrantActivity[]>([]);
  const [documents, setDocuments] = useState<GrantDocument[]>([]);
  const [reporting, setReporting] = useState<GrantReportingItem[]>([]);
  const [team, setTeam] = useState<GrantTeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    const [rec, hist, act, docs, rep, tm] = await Promise.all([
      supabase.from("grant_records").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("grant_stage_history")
        .select("*")
        .eq("grant_record_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("grant_activity_log")
        .select("*")
        .eq("grant_record_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("grant_documents").select("*").eq("grant_record_id", id),
      supabase.from("grant_reporting_items").select("*").eq("grant_record_id", id).order("due_date"),
      supabase.from("grant_team_members").select("*").eq("grant_record_id", id),
    ]);
    setRecord((rec.data as GrantRecord) ?? null);
    setHistory((hist.data as GrantStageHistory[]) ?? []);
    setActivity((act.data as GrantActivity[]) ?? []);
    setDocuments((docs.data as GrantDocument[]) ?? []);
    setReporting((rep.data as GrantReportingItem[]) ?? []);
    setTeam((tm.data as GrantTeamMember[]) ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (values: Partial<GrantRecord>, activityText?: string) => {
    if (!record || !user) return;
    const { data, error } = await supabase
      .from("grant_records")
      .update({ ...values, last_activity_at: new Date().toISOString() })
      .eq("id", record.id)
      .select("*")
      .single();
    if (error) {
      toast.error(error.message);
      return;
    }
    setRecord(data as GrantRecord);
    if (activityText) {
      await supabase
        .from("grant_activity_log")
        .insert({ grant_record_id: record.id, user_id: user.id, action: "updated", detail: activityText });
      void load();
    }
  };

  const changeStage = async (toStage: string) => {
    if (!record || !user || toStage === record.stage) return;
    await patch({ stage: toStage }, `Stage changed to ${STAGE_LABEL[toStage]}`);
    await supabase.from("grant_stage_history").insert({
      grant_record_id: record.id,
      user_id: user.id,
      from_stage: record.stage,
      to_stage: toStage,
    });
    void load();
  };

  const uploadDocument = async (file: File, documentType: string) => {
    if (!record || !user) return;
    setUploading(true);
    try {
      const path = `${user.id}/${record.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("grant-documents").upload(path, file);
      if (error) throw new Error(error.message);
      await supabase.from("grant_documents").insert({
        grant_record_id: record.id,
        user_id: user.id,
        name: file.name,
        document_type: documentType,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type,
      });
      await supabase.from("grant_activity_log").insert({
        grant_record_id: record.id,
        user_id: user.id,
        action: "document_uploaded",
        detail: file.name,
      });
      toast.success("Document uploaded.");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = async (doc: GrantDocument) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data) {
      toast.error("Could not open the document");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const deleteDocument = async (doc: GrantDocument) => {
    await supabase.storage.from("grant-documents").remove([doc.storage_path]);
    await supabase.from("grant_documents").delete().eq("id", doc.id);
    setDocuments((d) => d.filter((x) => x.id !== doc.id));
  };

  if (loading) {
    return (
      <AppShell title="Grant record">
        <Loader2 className="size-5 animate-spin text-primary" />
      </AppShell>
    );
  }

  if (!record) {
    return (
      <AppShell title="Grant record" description="This grant is no longer in your tracker.">
        <Button variant="outline" onClick={() => void navigate({ to: "/tracker" })}>
          <ArrowLeft className="mr-2 size-4" /> Back to tracker
        </Button>
      </AppShell>
    );
  }

  const reportingDone = reporting.filter((r) => r.submitted_date).length;
  const reportingPct = reporting.length ? Math.round((reportingDone / reporting.length) * 100) : 0;

  return (
    <AppShell title={record.grant_name} description={`${record.funder} · ${STAGE_LABEL[record.stage]}`}>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/tracker">
            <ArrowLeft className="mr-2 size-4" /> Tracker
          </Link>
        </Button>
        <Select value={record.stage} onValueChange={(v) => void changeStage(v)}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {record.portal_url && (
          <Button variant="outline" size="sm" asChild>
            <a href={record.portal_url} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 size-4" /> Grant portal
            </a>
          </Button>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="proposal">Proposal</TabsTrigger>
          <TabsTrigger value="activity">Activity log</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          {record.stage === "awarded" && <TabsTrigger value="reporting">Reporting</TabsTrigger>}
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <section className="grid gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-3">
            <Field label="Requested" value={formatMoney(record.requested_amount)} />
            <Field label="Submitted" value={formatMoney(record.submitted_amount)} />
            <Field label="Awarded" value={formatMoney(record.awarded_amount)} />
            <Field label="Deadline" value={formatDate(record.deadline)} />
            <Field label="Submission date" value={formatDate(record.submission_date)} />
            <Field
              label="Decision date"
              value={formatDate(record.decision_date_actual ?? record.decision_date_expected)}
            />
            <Field
              label="Match score"
              value={record.match_score === null ? "—" : `${record.match_score}%`}
            />
            <Field label="Funder type" value={record.funder_type} />
            <Field label="Outcome" value={record.outcome} />
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold text-foreground">Dates and amounts</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <EditableDate
                label="Expected decision"
                value={record.decision_date_expected}
                onSave={(v) => patch({ decision_date_expected: v }, "Expected decision date updated")}
              />
              <EditableNumber
                label="Requested amount"
                value={record.requested_amount}
                onSave={(v) => patch({ requested_amount: v }, "Requested amount updated")}
              />
              <EditableNumber
                label="Awarded amount"
                value={record.awarded_amount}
                onSave={(v) => patch({ awarded_amount: v }, "Awarded amount updated")}
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold text-foreground">Funder contact</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <EditableText
                label="Name"
                value={record.funder_contact_name}
                onSave={(v) => patch({ funder_contact_name: v }, "Funder contact updated")}
              />
              <EditableText
                label="Email"
                value={record.funder_contact_email}
                onSave={(v) => patch({ funder_contact_email: v }, "Funder contact updated")}
              />
              <EditableText
                label="Phone"
                value={record.funder_contact_phone}
                onSave={(v) => patch({ funder_contact_phone: v }, "Funder contact updated")}
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold text-foreground">Tags</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {record.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const tag = window.prompt("New tag");
                  if (tag) void patch({ tags: [...record.tags, tag] }, `Tag added: ${tag}`);
                }}
              >
                <Plus className="mr-1 size-3" /> Add tag
              </Button>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold text-foreground">Internal notes</h3>
            <Textarea
              className="mt-3 min-h-32"
              defaultValue={record.internal_notes ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (record.internal_notes ?? ""))
                  void patch({ internal_notes: e.target.value }, "Notes updated");
              }}
            />
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-bold text-foreground">Stage history</h3>
            <ol className="mt-3 space-y-2 text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-2 text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {h.from_stage ? `${STAGE_LABEL[h.from_stage]} → ` : ""}
                    {STAGE_LABEL[h.to_stage] ?? h.to_stage}
                  </span>
                  <span>{new Date(h.created_at).toLocaleString()}</span>
                </li>
              ))}
              {!history.length && <li className="text-muted-foreground">No stage changes yet.</li>}
            </ol>
          </section>
        </TabsContent>

        <TabsContent value="proposal" className="mt-6 space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            {record.proposal_id ? (
              <Button variant="outline" asChild>
                <Link to="/proposals/$id" params={{ id: record.proposal_id }}>
                  <FileText className="mr-2 size-4" /> Open the proposal draft
                </Link>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                No proposal draft is linked yet. Start one from Opportunities, or upload the submitted
                version in the Documents tab.
              </p>
            )}
            <p className="mt-4 text-sm text-muted-foreground">
              Submitted application and budget files live in the Documents tab, tagged{" "}
              <span className="font-semibold text-foreground">submitted application</span> and{" "}
              <span className="font-semibold text-foreground">budget</span>.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-6">
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 p-4 text-sm">
                <span className="font-semibold capitalize text-foreground">
                  {a.action.replace(/_/g, " ")}
                </span>
                <span className="text-muted-foreground">{a.detail}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </li>
            ))}
            {!activity.length && (
              <li className="p-6 text-center text-sm text-muted-foreground">No activity yet.</li>
            )}
          </ul>
        </TabsContent>

        <TabsContent value="documents" className="mt-6 space-y-4">
          <DocumentUpload uploading={uploading} onUpload={uploadDocument} />
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
                <FileText className="size-4 text-muted-foreground" />
                <span className="font-semibold text-foreground">{d.name}</span>
                <Badge variant="outline" className="capitalize">
                  {d.document_type.replace(/_/g, " ")}
                </Badge>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void downloadDocument(d)}>
                    <Download className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void deleteDocument(d)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
            {!documents.length && (
              <li className="p-6 text-center text-sm text-muted-foreground">No documents yet.</li>
            )}
          </ul>
        </TabsContent>

        {record.stage === "awarded" && (
          <TabsContent value="reporting" className="mt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">
                Upload the award contract to auto-build the full obligation, deadline and budget
                tracker.
              </p>
              <Button size="sm" variant="hero" className="ml-auto" asChild>
                <Link to="/compliance">Open Compliance Tracker</Link>
              </Button>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">

              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-foreground">
                  Reporting compliance: {reportingPct}%
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const title = window.prompt("Report name (e.g. Q1 Progress Report)");
                    if (!title || !user) return;
                    const due = window.prompt("Due date (YYYY-MM-DD)") ?? "";
                    await supabase.from("grant_reporting_items").insert({
                      grant_record_id: record.id,
                      user_id: user.id,
                      title,
                      due_date: due || null,
                    });
                    void load();
                  }}
                >
                  <Plus className="mr-2 size-4" /> Add report
                </Button>
              </div>
              <ul className="mt-4 divide-y divide-border">
                {reporting.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                    <span className="font-semibold text-foreground">{r.title}</span>
                    <span className="text-muted-foreground">Due {formatDate(r.due_date)}</span>
                    {r.submitted_date ? (
                      <Badge variant="secondary">Submitted {formatDate(r.submitted_date)}</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={async () => {
                          await supabase
                            .from("grant_reporting_items")
                            .update({ submitted_date: new Date().toISOString().slice(0, 10) })
                            .eq("id", r.id);
                          void load();
                        }}
                      >
                        Mark submitted
                      </Button>
                    )}
                  </li>
                ))}
                {!reporting.length && (
                  <li className="py-6 text-center text-muted-foreground">
                    No reporting schedule yet. Add the deadlines from your award letter.
                  </li>
                )}
              </ul>
            </div>
          </TabsContent>
        )}

        <TabsContent value="team" className="mt-6 space-y-4">
          {!caps.teamAssignment ? (
            <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
              <Lock className="mb-2 size-4" />
              Team assignment is available on Growth and above.{" "}
              <Link
                to="/billing"
                search={{ plan: undefined, annual: false, checkout: undefined }}
                className="font-semibold text-primary hover:underline"
              >
                Upgrade
              </Link>
            </div>
          ) : (
            <TeamPanel
              members={team}
              onAdd={async (name, email, role) => {
                if (!user) return;
                await supabase.from("grant_team_members").insert({
                  grant_record_id: record.id,
                  user_id: user.id,
                  member_name: name,
                  member_email: email || null,
                  member_role: role,
                });
                await supabase.from("grant_activity_log").insert({
                  grant_record_id: record.id,
                  user_id: user.id,
                  action: "team_assigned",
                  detail: `${name} — ${role}`,
                });
                void load();
              }}
              onRemove={async (memberId) => {
                await supabase.from("grant_team_members").delete().eq("id", memberId);
                void load();
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold capitalize text-foreground">{value}</p>
    </div>
  );
}

function EditableText({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        defaultValue={value ?? ""}
        onBlur={(e) => {
          if (e.target.value !== (value ?? "")) onSave(e.target.value);
        }}
      />
    </div>
  );
}

function EditableDate({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string | null;
  onSave: (v: string | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="date"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          if (e.target.value !== (value ?? "")) onSave(e.target.value || null);
        }}
      />
    </div>
  );
}

function EditableNumber({
  label,
  value,
  onSave,
}: {
  label: string;
  value: number | null;
  onSave: (v: number | null) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min="0"
        defaultValue={value ?? ""}
        onBlur={(e) => {
          const next = e.target.value ? Number(e.target.value) : null;
          if (next !== value) onSave(next);
        }}
      />
    </div>
  );
}

function DocumentUpload({
  uploading,
  onUpload,
}: {
  uploading: boolean;
  onUpload: (file: File, type: string) => Promise<void>;
}) {
  const [type, setType] = useState<string>("other");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DOCUMENT_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="capitalize">
              {t.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Label
        htmlFor="doc-upload"
        className="inline-flex cursor-pointer items-center rounded-md border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
      >
        {uploading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
        Upload document
      </Label>
      <input
        id="doc-upload"
        type="file"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file, type);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function TeamPanel({
  members,
  onAdd,
  onRemove,
}: {
  members: GrantTeamMember[];
  onAdd: (name: string, email: string, role: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(TEAM_ROLES[0]);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-bold text-foreground">Assigned team</h3>
      <ul className="mt-3 divide-y divide-border">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="font-semibold text-foreground">{m.member_name}</span>
            <Badge variant="outline">{m.member_role}</Badge>
            <span className="text-muted-foreground">{m.member_email}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void onRemove(m.id)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
        {!members.length && <li className="py-3 text-sm text-muted-foreground">Nobody assigned yet.</li>}
      </ul>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TEAM_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          disabled={!name.trim()}
          onClick={async () => {
            await onAdd(name.trim(), email.trim(), role);
            setName("");
            setEmail("");
          }}
        >
          <Plus className="mr-2 size-4" /> Assign
        </Button>
      </div>
    </div>
  );
}
