import { useEffect, useState } from "react";
import { Download, Loader2, Paperclip, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useTaskDetail, logActivity } from "@/hooks/useTaskDetail";
import { safeStorageName, validateFileUpload } from "@/lib/security";
import { logSecurityEvent } from "@/hooks/useSecurityLog";
import {
  CATEGORY_LABEL,
  OBLIGATION_STATUSES,
  PRIORITIES,
  RECURRENCES,
  confidenceLevel,
  formatDate,
  nextOccurrence,
  type ComplianceDocument,
  type ComplianceObligation,
} from "@/lib/compliance";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

export function ObligationPanel({
  obligation,
  userId,
  contractId,
  canAssign,
  evidence,
  onClose,
  onSave,
  onDocumentAdded,
}: {
  obligation: ComplianceObligation | null;
  userId: string;
  contractId: string;
  canAssign: boolean;
  evidence: ComplianceDocument[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<ComplianceObligation>) => Promise<void>;
  onDocumentAdded: () => void;
}) {
  const [draft, setDraft] = useState<ComplianceObligation | null>(obligation);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newAssignee, setNewAssignee] = useState({ name: "", email: "" });
  const [commentBody, setCommentBody] = useState("");
  const detail = useTaskDetail(obligation?.id ?? null, userId);

  useEffect(() => setDraft(obligation), [obligation]);

  if (!draft) return null;

  const files = evidence.filter((d) => d.obligation_id === draft.id);
  const closing = draft.status === "complete";

  const save = async () => {
    setSaving(true);
    try {
      const statusChanged = obligation && obligation.status !== draft.status;
      const dueChanged = obligation && obligation.due_date !== draft.due_date;
      await onSave(draft.id, {
        title: draft.title,
        description: draft.description,
        status: draft.status,
        due_date: draft.due_date,
        recurrence: draft.recurrence,
        recurrence_rule: draft.recurrence_rule,
        next_due_date:
          draft.recurrence === "one_time"
            ? null
            : nextOccurrence(draft.due_date, draft.recurrence),
        priority: draft.priority,
        assignee_name: draft.assignee_name,
        assignee_email: draft.assignee_email,
        submit_to_name: draft.submit_to_name,
        submit_to_email: draft.submit_to_email,
        submit_to_address: draft.submit_to_address,
        notes: draft.notes,
        submission_confirmation: draft.submission_confirmation,
        reminders_silenced: draft.reminders_silenced,
        percent_complete: draft.percent_complete,
        completion_notes: draft.completion_notes,
        snoozed_until: draft.snoozed_until,
        completed_at: closing ? new Date().toISOString() : null,
        completed_by: closing ? userId : null,
      });
      if (statusChanged) {
        await logActivity({
          contract_id: contractId,
          obligation_id: draft.id,
          user_id: userId,
          action: "status_changed",
          old_value: obligation?.status ?? null,
          new_value: draft.status,
        });
      }
      if (dueChanged) {
        await logActivity({
          contract_id: contractId,
          obligation_id: draft.id,
          user_id: userId,
          action: "due_date_changed",
          old_value: obligation?.due_date ?? null,
          new_value: draft.due_date,
        });
      }
      toast.success("Task updated.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const upload = async (fileList: File[]) => {
    setUploading(true);
    try {
      for (const file of fileList) {
        const problem = validateFileUpload(file);
        if (problem) {
          toast.error(problem);
          continue;
        }
        const safe = safeStorageName(file.name);
        const path = `${userId}/compliance/${contractId}/${crypto.randomUUID()}-${safe}`;
        const up = await supabase.storage
          .from("grant-documents")
          .upload(path, file, { contentType: file.type || "application/octet-stream" });
        if (up.error) throw new Error(up.error.message);
        const { error } = await supabase.from("compliance_documents").insert({
          contract_id: contractId,
          obligation_id: draft.id,
          user_id: userId,
          name: file.name,
          document_type: "evidence",
          storage_path: path,
          size_bytes: file.size,
          mime_type: file.type,
        });
        if (error) throw new Error(error.message);
        await logActivity({
          contract_id: contractId,
          obligation_id: draft.id,
          user_id: userId,
          action: "evidence_uploaded",
          new_value: file.name,
        });
        await logSecurityEvent(userId, "evidence.uploaded", {
          resourceType: "compliance_document",
          resourceId: draft.id,
          metadata: { name: file.name, size_bytes: file.size },
        });
      }
      toast.success(fileList.length > 1 ? "Evidence uploaded." : "Evidence uploaded.");
      onDocumentAdded();
      void detail.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const openFile = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(path, 60);
    if (error || !data) {
      toast.error("Could not open that file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const downloadFile = async (doc: ComplianceDocument) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(doc.storage_path, 60, { download: doc.name });
    if (error || !data) {
      toast.error("Could not download that file");
      return;
    }
    window.location.href = data.signedUrl;
  };

  const deleteFile = async (doc: ComplianceDocument) => {
    try {
      await supabase.storage.from("grant-documents").remove([doc.storage_path]);
      const { error } = await supabase.from("compliance_documents").delete().eq("id", doc.id);
      if (error) throw new Error(error.message);
      await logActivity({
        contract_id: contractId,
        obligation_id: draft.id,
        user_id: userId,
        action: "evidence_removed",
        old_value: doc.name,
      });
      toast.success("Evidence removed.");
      onDocumentAdded();
      void detail.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove evidence");
    }
  };


  const conf = confidenceLevel(draft.confidence);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <Input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="border-none px-0 text-lg font-bold shadow-none focus-visible:ring-0"
            />
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{CATEGORY_LABEL[draft.category] ?? draft.category}</Badge>
            <Badge variant="outline">{CONFIDENCE_LABEL[conf]} confidence</Badge>
            {draft.prior_approval_required && (
              <Badge variant="destructive">Prior approval required</Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OBLIGATION_STATUSES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Priority</Label>
            <Select
              value={draft.priority}
              onValueChange={(v) => setDraft({ ...draft, priority: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due date</Label>
            <Input
              type="date"
              value={draft.due_date ?? ""}
              onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
            />
          </div>
        </div>

        <Tabs defaultValue="details" className="mt-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="assignees">Assignees</TabsTrigger>
            <TabsTrigger value="evidence">Evidence</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="comments">Comments</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={3}
                value={draft.description ?? ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            {draft.source_quote && (
              <blockquote className="border-l-2 border-primary/40 pl-3 text-xs italic text-muted-foreground">
                “{draft.source_quote}”
                {draft.source_page !== null && <span> — page {draft.source_page}</span>}
              </blockquote>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Recurrence</Label>
                <Select
                  value={draft.recurrence}
                  onValueChange={(v) => setDraft({ ...draft, recurrence: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECURRENCES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Recurrence rule</Label>
                <Input
                  placeholder="e.g. 30 days after quarter end"
                  value={draft.recurrence_rule ?? ""}
                  onChange={(e) => setDraft({ ...draft, recurrence_rule: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Next occurrence</Label>
                <Input
                  readOnly
                  value={
                    draft.recurrence === "one_time"
                      ? "—"
                      : formatDate(nextOccurrence(draft.due_date, draft.recurrence))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Percent complete</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.percent_complete}
                  onChange={(e) =>
                    setDraft({ ...draft, percent_complete: Number(e.target.value || 0) })
                  }
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Submit to (name / title)</Label>
                <Input
                  value={draft.submit_to_name ?? ""}
                  onChange={(e) => setDraft({ ...draft, submit_to_name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Submit to (email)</Label>
                <Input
                  type="email"
                  value={draft.submit_to_email ?? ""}
                  onChange={(e) => setDraft({ ...draft, submit_to_email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Submit to (address / portal)</Label>
                <Input
                  value={draft.submit_to_address ?? ""}
                  onChange={(e) => setDraft({ ...draft, submit_to_address: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Notes / instructions</Label>
              <Textarea
                rows={2}
                value={draft.notes ?? ""}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Snooze alerts until</Label>
                <Input
                  type="date"
                  value={draft.snoozed_until ?? ""}
                  onChange={(e) => setDraft({ ...draft, snoozed_until: e.target.value || null })}
                />
              </div>
              <label className="flex items-end gap-2 pb-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.reminders_silenced}
                  onChange={(e) => setDraft({ ...draft, reminders_silenced: e.target.checked })}
                />
                Silence reminders (handled outside the platform)
              </label>
            </div>
          </TabsContent>

          <TabsContent value="assignees" className="mt-4 space-y-3">
            {!canAssign && (
              <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Team assignment is available on Growth and above.
              </p>
            )}
            <ul className="space-y-2">
              {detail.assignees.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border border-border p-2 text-sm"
                >
                  <span>
                    {a.member_name}
                    {a.member_email && (
                      <span className="text-muted-foreground"> · {a.member_email}</span>
                    )}
                    <span className="ml-2 text-xs text-muted-foreground">
                      assigned {formatDate(a.assigned_at.slice(0, 10))}
                    </span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void detail.removeAssignee(a)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </li>
              ))}
              {!detail.assignees.length && (
                <li className="text-sm text-muted-foreground">Nobody assigned yet.</li>
              )}
            </ul>
            {canAssign && (
              <div className="flex flex-wrap gap-2">
                <Input
                  placeholder="Name"
                  className="max-w-[10rem]"
                  value={newAssignee.name}
                  onChange={(e) => setNewAssignee({ ...newAssignee, name: e.target.value })}
                />
                <Input
                  placeholder="Email"
                  type="email"
                  className="max-w-[14rem]"
                  value={newAssignee.email}
                  onChange={(e) => setNewAssignee({ ...newAssignee, email: e.target.value })}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newAssignee.name.trim()}
                  onClick={() => {
                    void detail.addAssignee(contractId, newAssignee.name, newAssignee.email);
                    setNewAssignee({ name: "", email: "" });
                  }}
                >
                  <UserPlus className="mr-2 size-4" /> Assign
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="evidence" className="mt-4 space-y-3">
            <ul className="space-y-2">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {f.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {Math.round((f.size_bytes ?? 0) / 1024)} KB
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => void openFile(f.storage_path)}>
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void downloadFile(f)}>
                      <Download className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => void deleteFile(f)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </span>
                </li>
              ))}
              {!files.length && (
                <li className="text-sm text-muted-foreground">No evidence attached yet.</li>
              )}
            </ul>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary">
              {uploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Paperclip className="size-4" />
              )}
              Attach evidence (report, confirmation, invoice…) — up to 50MB each
              <input
                type="file"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const fs = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (fs.length) void upload(fs);
                }}
              />

            </label>

            <div className="space-y-1.5">
              <Label className="text-xs">Submission confirmation / tracking number</Label>
              <Input
                value={draft.submission_confirmation ?? ""}
                onChange={(e) => setDraft({ ...draft, submission_confirmation: e.target.value })}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={draft.status === "under_review" || draft.status === "complete"}
                onChange={(e) =>
                  setDraft({ ...draft, status: e.target.checked ? "under_review" : "in_progress" })
                }
              />
              Mark as submitted (moves the task to Under review)
            </label>

            <div className="space-y-1.5">
              <Label className="text-xs">Completion notes</Label>
              <Textarea
                rows={2}
                value={draft.completion_notes ?? ""}
                onChange={(e) => setDraft({ ...draft, completion_notes: e.target.value })}
              />
            </div>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <ul className="space-y-2 text-sm">
              {detail.activity.map((a) => (
                <li key={a.id} className="rounded-lg border border-border p-2">
                  <span className="font-medium text-foreground">{a.action.replace(/_/g, " ")}</span>
                  {a.old_value && a.new_value && (
                    <span className="text-muted-foreground">
                      {" "}
                      — {a.old_value} → {a.new_value}
                    </span>
                  )}
                  {!a.old_value && a.new_value && (
                    <span className="text-muted-foreground"> — {a.new_value}</span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
              {!detail.activity.length && (
                <li className="text-muted-foreground">No activity recorded yet.</li>
              )}
            </ul>
          </TabsContent>

          <TabsContent value="comments" className="mt-4 space-y-3">
            <ul className="space-y-2 text-sm">
              {detail.comments
                .filter((c) => !c.parent_id)
                .map((c) => (
                  <li key={c.id} className="rounded-lg border border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      {c.author_name ?? "You"} · {new Date(c.created_at).toLocaleString()}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{c.body}</p>
                    <ul className="mt-2 space-y-2 border-l-2 border-border pl-3">
                      {detail.comments
                        .filter((r) => r.parent_id === c.id)
                        .map((r) => (
                          <li key={r.id}>
                            <p className="text-xs text-muted-foreground">
                              {r.author_name ?? "You"} · {new Date(r.created_at).toLocaleString()}
                            </p>
                            <p className="whitespace-pre-wrap">{r.body}</p>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
              {!detail.comments.length && (
                <li className="text-muted-foreground">No comments yet.</li>
              )}
            </ul>
            <Textarea
              rows={2}
              placeholder="Add a comment. Use @email to mention a teammate."
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!commentBody.trim()}
              onClick={() => {
                void detail.addComment(contractId, commentBody, "You");
                setCommentBody("");
              }}
            >
              Post comment
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="hero" disabled={saving} onClick={() => void save()}>
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
