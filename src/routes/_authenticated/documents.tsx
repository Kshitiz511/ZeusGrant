import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/_authenticated/documents")({
  head: () => ({
    meta: [
      { title: "Document Center | ZCS GrantMatch Innovation" },
      {
        name: "description",
        content:
          "One private library for organization records, grant attachments and compliance evidence.",
      },
      { property: "og:title", content: "Document Center | ZCS GrantMatch Innovation" },
      {
        property: "og:description",
        content: "Every file behind your applications, awards and compliance work in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DocumentsPage,
});

const ORG_DOC_TYPES = [
  { id: "irs_determination", label: "IRS determination letter" },
  { id: "financials", label: "Financial statement / audit" },
  { id: "budget", label: "Organizational budget" },
  { id: "board_list", label: "Board list" },
  { id: "bylaws", label: "Bylaws / articles" },
  { id: "w9", label: "W-9" },
  { id: "insurance", label: "Insurance certificate" },
  { id: "logic_model", label: "Logic model / evaluation plan" },
  { id: "letter_of_support", label: "Letter of support" },
  { id: "other", label: "Other" },
] as const;

const ORG_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ORG_DOC_TYPES.map((t) => [t.id, t.label]),
);

type Row = {
  id: string;
  name: string;
  documentType: string;
  storagePath: string;
  sizeBytes: number | null;
  createdAt: string;
  source: "org" | "grant" | "compliance";
  contextLabel: string;
  contextTo?: string;
  contextParams?: Record<string, string>;
};

const SOURCE_LABEL: Record<Row["source"], string> = {
  org: "Organization",
  grant: "Grant record",
  compliance: "Compliance",
};

function fileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DocumentsPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState<string>("other");
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const [org, grants, compliance, records, contracts] = await Promise.all([
      supabase.from("org_documents").select("*").eq("user_id", user.id),
      supabase.from("grant_documents").select("*").eq("user_id", user.id),
      supabase.from("compliance_documents").select("*").eq("user_id", user.id),
      supabase.from("grant_records").select("id, grant_name").eq("user_id", user.id),
      supabase.from("compliance_contracts").select("id, name").eq("user_id", user.id),
    ]);

    const recordName = new Map((records.data ?? []).map((r) => [r.id, r.grant_name]));
    const contractName = new Map((contracts.data ?? []).map((c) => [c.id, c.name]));

    const all: Row[] = [
      ...(org.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        documentType: ORG_TYPE_LABEL[d.document_type] ?? d.document_type,
        storagePath: d.storage_path,
        sizeBytes: d.size_bytes,
        createdAt: d.created_at,
        source: "org" as const,
        contextLabel: "Organization library",
      })),
      ...(grants.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.document_type,
        storagePath: d.storage_path,
        sizeBytes: d.size_bytes,
        createdAt: d.created_at,
        source: "grant" as const,
        contextLabel: recordName.get(d.grant_record_id) ?? "Grant record",
        contextTo: "/tracker/$id",
        contextParams: { id: d.grant_record_id },
      })),
      ...(compliance.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        documentType: d.document_type,
        storagePath: d.storage_path,
        sizeBytes: d.size_bytes,
        createdAt: d.created_at,
        source: "compliance" as const,
        contextLabel: contractName.get(d.contract_id) ?? "Contract",
        contextTo: "/compliance/$id",
        contextParams: { id: d.contract_id },
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    setRows(all);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (sourceFilter === "all" || r.source === sourceFilter) &&
        (!q ||
          r.name.toLowerCase().includes(q) ||
          r.contextLabel.toLowerCase().includes(q) ||
          r.documentType.toLowerCase().includes(q)),
    );
  }, [rows, query, sourceFilter]);

  const upload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `${user.id}/library/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("grant-documents").upload(path, file);
      if (error) throw new Error(error.message);
      const insert = await supabase.from("org_documents").insert({
        user_id: user.id,
        name: file.name,
        document_type: docType,
        storage_path: path,
        size_bytes: file.size,
        mime_type: file.type,
      });
      if (insert.error) throw new Error(insert.error.message);
      toast.success("Document uploaded.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const download = async (row: Row) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(row.storagePath, 60);
    if (error || !data) {
      toast.error("Could not open the document");
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const remove = async (row: Row) => {
    if (row.source !== "org") {
      toast.info("Remove this file from its grant record or contract.");
      return;
    }
    await supabase.storage.from("grant-documents").remove([row.storagePath]);
    await supabase.from("org_documents").delete().eq("id", row.id);
    setRows((rs) => rs.filter((r) => r.id !== row.id));
    toast.success("Document removed.");
  };

  return (
    <AppShell
      title="Document Center"
      description="Every file behind your applications, awards and compliance work, in one private library."
    >
      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-foreground">Add to your organization library</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep reusable attachments — determination letter, audits, board list — ready for every
          application.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Select value={docType} onValueChange={setDocType}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Document type" />
            </SelectTrigger>
            <SelectContent>
              {ORG_DOC_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            Upload file
          </Button>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents"
          className="max-w-xs"
        />
        <Select value={sourceFilter} onValueChange={setSourceFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="org">Organization</SelectItem>
            <SelectItem value="grant">Grant records</SelectItem>
            <SelectItem value="compliance">Compliance</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} file(s)</span>
      </div>

      {loading ? (
        <Loader2 className="size-5 animate-spin text-primary" />
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No documents yet. Upload your reusable organization files above, or attach files from a
          grant record or contract.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {filtered.map((row) => (
            <li key={`${row.source}-${row.id}`} className="flex items-center gap-3 p-4">
              <FileText className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.documentType} · {fileSize(row.sizeBytes)} ·{" "}
                  {row.contextTo ? (
                    <Link
                      to={row.contextTo}
                      params={row.contextParams as never}
                      className="underline underline-offset-2"
                    >
                      {row.contextLabel}
                    </Link>
                  ) : (
                    row.contextLabel
                  )}
                </p>
              </div>
              <Badge variant="secondary">{SOURCE_LABEL[row.source]}</Badge>
              <Button variant="ghost" size="sm" onClick={() => void download(row)}>
                <Download className="size-4" />
                <span className="sr-only">Download {row.name}</span>
              </Button>
              {row.source === "org" && (
                <Button variant="ghost" size="sm" onClick={() => void remove(row)}>
                  <Trash2 className="size-4 text-destructive" />
                  <span className="sr-only">Delete {row.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
