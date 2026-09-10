import { useRef, useState } from "react";
import { BarChart3, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { extractPriorProposal } from "@/utils/profile.functions";
import { supabase } from "@/integrations/supabase/client";
import { extractText } from "@/lib/compliance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BLOCK_TYPE_LABEL, DOCUMENT_TYPE_LABEL, wordCount } from "@/lib/profile-intelligence";
import { openProfileFile, uploadProfileFile } from "@/hooks/useProfileIntelligence";
import type { ContentBlock, ImpactStat, SourceDocument } from "@/hooks/useProfileIntelligence";

const MAX_BYTES = 20 * 1024 * 1024;

const UPLOAD_KINDS = [
  { value: "prior_proposal", label: "Proposal we submitted" },
  { value: "award_notice", label: "Award notice / grant agreement" },
  { value: "solicitation", label: "RFP / solicitation we responded to" },
  { value: "past_performance", label: "Past performance write-up" },
] as const;

export function PastWorkTab({
  userId,
  documents,
  blocks,
  stats,
  onChange,
}: {
  userId: string;
  documents: SourceDocument[];
  blocks: ContentBlock[];
  stats: ImpactStat[];
  onChange: () => Promise<void> | void;
}) {
  const runProposal = useServerFn(extractPriorProposal);
  const [kind, setKind] = useState<string>("prior_proposal");
  const [busy, setBusy] = useState(false);
  const [blockFilter, setBlockFilter] = useState("all");
  const [statText, setStatText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files).slice(0, 20)) {
      try {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20MB.`);
        const text = await extractText(file);
        const path = await uploadProfileFile(userId, file, "past-work");
        const extracted = await runProposal({ data: { text, fileName: file.name } });

        const { data: doc, error: docError } = await supabase
          .from("profile_source_documents")
          .insert({
            user_id: userId,
            document_type: kind,
            file_name: file.name,
            file_path: path,
            file_size: file.size,
            funder_name: extracted.funder_name,
            opportunity_title: extracted.opportunity_title,
            program_area: extracted.program_area,
            award_amount: extracted.award_amount,
            award_status: kind === "award_notice" ? "awarded" : "unknown",
            extraction_status: "complete",
            extraction_completed_at: new Date().toISOString(),
            extracted_count: extracted.blocks.length,
          })
          .select("id")
          .single();
        if (docError) throw new Error(docError.message);

        if (extracted.blocks.length) {
          await supabase.from("proposal_content_library").insert(
            extracted.blocks
              .filter((b) => b.content?.trim())
              .map((b) => ({
                user_id: userId,
                source_document_id: doc.id,
                block_type: b.block_type || "other",
                title: b.title || null,
                content: b.content,
                tone: b.tone || null,
                word_count: wordCount(b.content),
                funder_type: extracted.funder_type,
                program_area: extracted.program_area,
                award_status: kind === "award_notice" ? "awarded" : "unknown",
              })),
          );
        }

        if (extracted.impact_statistics.length) {
          await supabase.from("impact_statistics").insert(
            extracted.impact_statistics
              .filter((s) => s.stat_text?.trim())
              .map((s) => ({
                user_id: userId,
                source_document_id: doc.id,
                stat_text: s.stat_text,
                numeric_value: s.numeric_value,
                unit: s.unit,
                program_area: s.program_area,
                time_period: s.time_period,
              })),
          );
        }

        toast.success(`${file.name}: ${extracted.blocks.length} reusable sections saved.`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not read ${file.name}.`);
      }
    }
    setBusy(false);
    await onChange();
  }

  async function addStat() {
    if (!statText.trim()) return;
    await supabase.from("impact_statistics").insert({
      user_id: userId,
      stat_text: statText.trim(),
      verified: true,
    });
    setStatText("");
    await onChange();
  }

  const pastWork = documents.filter((d) =>
    ["prior_proposal", "award_notice", "solicitation", "past_performance"].includes(d.document_type),
  );
  const filtered = blockFilter === "all" ? blocks : blocks.filter((b) => b.block_type === blockFilter);
  const blockTypes = [...new Set(blocks.map((b) => b.block_type))];
  const awarded = pastWork.filter((d) => d.award_status === "awarded");
  const totalAwarded = awarded.reduce((sum, d) => sum + (d.award_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload past proposals and awards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Document type</span>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UPLOAD_KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              Upload documents
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            We pull reusable narrative sections, impact numbers and award details out of each document
            so you can drop them straight into new proposals.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Documents</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{pastWork.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Awards on file</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{awarded.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Total awarded</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              ${totalAwarded.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {pastWork.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past performance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastWork.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {d.opportunity_title ?? d.file_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {DOCUMENT_TYPE_LABEL[d.document_type] ?? d.document_type}
                    {d.funder_name ? ` · ${d.funder_name}` : ""}
                    {d.award_amount ? ` · $${d.award_amount.toLocaleString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {(d.award_status ?? "unknown").replace("_", " ")}
                  </Badge>
                  {d.file_path && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void openProfileFile(d.file_path!)}
                    >
                      <FileText className="mr-2 size-4" /> Open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Reusable content library ({blocks.length})</CardTitle>
          <Select value={blockFilter} onValueChange={setBlockFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {blockTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {BLOCK_TYPE_LABEL[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Upload a past proposal to start building your reusable content library.
            </p>
          )}
          {filtered.map((b) => (
            <div key={b.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{BLOCK_TYPE_LABEL[b.block_type] ?? b.block_type}</Badge>
                  <span className="text-sm font-semibold text-foreground">{b.title ?? "Untitled"}</span>
                  <span className="text-xs text-muted-foreground">{b.word_count} words</span>
                  {b.award_status === "awarded" && (
                    <Badge variant="secondary">From an awarded proposal</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(b.content);
                      toast.success("Copied to clipboard.");
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await supabase.from("proposal_content_library").delete().eq("id", b.id);
                      await onChange();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">
                {b.content}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" /> Impact statistics ({stats.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Textarea
              value={statText}
              onChange={(e) => setStatText(e.target.value)}
              placeholder="e.g. Served 1,240 families across 3 counties in 2025"
              rows={2}
            />
            <Button onClick={() => void addStat()}>Add</Button>
          </div>
          {stats.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <p className="text-sm text-foreground">{s.stat_text}</p>
              <div className="flex items-center gap-2">
                {s.verified && <Badge variant="secondary">Verified</Badge>}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await supabase.from("impact_statistics").delete().eq("id", s.id);
                    await onChange();
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
