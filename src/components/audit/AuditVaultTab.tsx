import { useMemo, useRef, useState } from "react";
import {
  Download,
  FileCheck2,
  FileDown,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { AuditReadinessGauge } from "@/components/audit/AuditReadinessGauge";
import { supabase } from "@/integrations/supabase/client";
import {
  EVIDENCE_DOCUMENT_TYPES,
  auditReadiness,
  formatStamp,
  randomToken,
  sha256,
  shortHash,
  type AuditPackage,
  type EvidenceFile,
  type RegulatoryCitation,
} from "@/lib/audit";
import { useAuditVault } from "@/hooks/useAuditVault";
import {
  CATEGORY_CLASS,
  CATEGORY_LABEL,
  OBLIGATION_CATEGORIES,
  STATUS_LABEL,
  formatDate,
  type ComplianceContract,
  type ComplianceObligation,
} from "@/lib/compliance";
import { downloadFile, printHtml } from "@/lib/tracker";
import { cn } from "@/lib/utils";

const MAX_BYTES = 50 * 1024 * 1024;

export function AuditVaultTab({
  contract,
  obligations,
  userId,
  uploaderName,
  enterprise,
}: {
  contract: ComplianceContract;
  obligations: ComplianceObligation[];
  userId: string;
  uploaderName: string;
  enterprise: boolean;
}) {
  const { evidence, packages, citations, access, refetch } = useAuditVault(contract.id, userId);
  const readiness = useMemo(() => auditReadiness(obligations, evidence), [obligations, evidence]);
  const [open, setOpen] = useState<string | null>(null);

  const byObligation = useMemo(() => {
    const map = new Map<string, EvidenceFile[]>();
    for (const file of evidence) {
      if (!file.obligation_id) continue;
      const list = map.get(file.obligation_id) ?? [];
      list.push(file);
      map.set(file.obligation_id, list);
    }
    return map;
  }, [evidence]);

  const grouped = useMemo(
    () =>
      OBLIGATION_CATEGORIES.map((c) => ({
        category: c.id,
        label: CATEGORY_LABEL[c.id] ?? c.id,
        items: obligations.filter((o) => o.category === c.id),
      })).filter((g) => g.items.length > 0),
    [obligations],
  );

  return (
    <div className="space-y-8">
      <div className="grid gap-4 rounded-xl border border-border bg-card p-6 lg:grid-cols-[auto_1fr_auto] lg:items-center">
        <AuditReadinessGauge readiness={readiness} />
        <div className="text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">
            {evidence.length} evidence {evidence.length === 1 ? "file" : "files"} in this vault
          </p>
          <p className="mt-1">
            Every upload is stored privately, stamped with the server time and fingerprinted with a
            SHA-256 hash so you can prove the file has not changed.
          </p>
          {readiness.missing.length > 0 && (
            <p className="mt-2 text-destructive">
              {readiness.missing.length} obligation
              {readiness.missing.length === 1 ? "" : "s"} still need evidence.
            </p>
          )}
        </div>
        <PackageActions
          contract={contract}
          obligations={obligations}
          evidence={evidence}
          citations={citations}
          packages={packages}
          userId={userId}
          readinessScore={readiness.score}
          onChange={refetch}
        />
      </div>

      <section className="space-y-6">
        {grouped.map((group) => (
          <div key={group.category} className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-sm font-bold text-foreground">{group.label}</h3>
              <Badge variant="outline" className={cn(CATEGORY_CLASS[group.category])}>
                {group.items.length} obligations
              </Badge>
            </div>
            <ul className="divide-y divide-border">
              {group.items.map((o) => {
                const files = byObligation.get(o.id) ?? [];
                const expanded = open === o.id;
                return (
                  <li key={o.id} className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : o.id)}
                      className="flex w-full items-start justify-between gap-4 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{o.title}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {STATUS_LABEL[o.status] ?? o.status} · due {formatDate(o.due_date)}
                          {o.recurrence && o.recurrence !== "one_time" ? ` · ${o.recurrence}` : ""}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          files.length
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
                            : "border-border text-muted-foreground"
                        }
                      >
                        {files.length ? `${files.length} evidence` : "No evidence"}
                      </Badge>
                    </button>

                    {expanded && (
                      <div className="mt-4 space-y-4">
                        <EvidenceList files={files} onChange={refetch} />
                        <EvidenceUploader
                          contract={contract}
                          obligation={o}
                          userId={userId}
                          uploaderName={uploaderName}
                          onUploaded={refetch}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <CitationsPanel
        contractId={contract.id}
        userId={userId}
        citations={citations}
        onChange={refetch}
      />

      {enterprise && (
        <AgencyPortalPanel
          contractId={contract.id}
          userId={userId}
          access={access}
          onChange={refetch}
        />
      )}

      <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
        Evidence files and their timestamps form the audit record for this contract. Files can be
        removed, but the compliance package always reflects what is in the vault at the moment it is
        generated.
      </p>
    </div>
  );
}

function EvidenceList({ files, onChange }: { files: EvidenceFile[]; onChange: () => void }) {
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground">No evidence uploaded yet.</p>;
  }

  const openFile = async (file: EvidenceFile, download: boolean) => {
    const { data, error } = await supabase.storage
      .from("grant-documents")
      .createSignedUrl(file.storage_path, 300, download ? { download: file.file_name } : undefined);
    if (error || !data) {
      toast.error("Could not open this file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  const remove = async (file: EvidenceFile) => {
    await supabase.storage.from("grant-documents").remove([file.storage_path]);
    const { error } = await supabase.from("evidence_vault_files").delete().eq("id", file.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Evidence removed");
    onChange();
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-semibold">File</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 font-semibold">Uploaded</th>
            <th className="px-3 py-2 font-semibold">By</th>
            <th className="px-3 py-2 font-semibold">Confirmation</th>
            <th className="px-3 py-2 font-semibold">SHA-256</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {files.map((f) => (
            <tr key={f.id}>
              <td className="max-w-[220px] truncate px-3 py-2 font-medium text-foreground">
                {f.file_name}
                {f.notes && <span className="block text-muted-foreground">{f.notes}</span>}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{f.document_type}</td>
              <td className="px-3 py-2 text-muted-foreground">{formatStamp(f.upload_timestamp)}</td>
              <td className="px-3 py-2 text-muted-foreground">{f.uploaded_by_name ?? "—"}</td>
              <td className="px-3 py-2 text-muted-foreground">{f.submission_confirmation ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{shortHash(f.file_hash)}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void openFile(f, false)}>
                    Open
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void openFile(f, true)}>
                    <Download className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(f)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceUploader({
  contract,
  obligation,
  userId,
  uploaderName,
  onUploaded,
}: {
  contract: ComplianceContract;
  obligation: ComplianceObligation;
  userId: string;
  uploaderName: string;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documentType, setDocumentType] = useState<string>(EVIDENCE_DOCUMENT_TYPES[0]);
  const [cycle, setCycle] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 50MB`);
        const hash = await sha256(file);
        const path = `${userId}/audit/${contract.id}/${obligation.id}/${Date.now()}-${file.name}`;
        const { error: upErr } = await supabase.storage
          .from("grant-documents")
          .upload(path, file, { upsert: false });
        if (upErr) throw new Error(upErr.message);
        const { error } = await supabase.from("evidence_vault_files").insert({
          user_id: userId,
          contract_id: contract.id,
          obligation_id: obligation.id,
          category: obligation.category,
          compliance_cycle: cycle || null,
          document_type: documentType,
          file_name: file.name,
          storage_path: path,
          size_bytes: file.size,
          mime_type: file.type || null,
          file_hash: hash,
          submission_confirmation: confirmation || null,
          uploaded_by_name: uploaderName,
          notes: notes || null,
        });
        if (error) throw new Error(error.message);
      }
      toast.success("Evidence added to the vault");
      setConfirmation("");
      setNotes("");
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-lg border border-dashed border-border p-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Document type</label>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVIDENCE_DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Compliance cycle</label>
          <Input
            className="mt-1"
            placeholder="e.g. Q1 2026"
            value={cycle}
            onChange={(e) => setCycle(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Confirmation number</label>
          <Input
            className="mt-1"
            placeholder="Portal / email reference"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Notes</label>
          <Textarea
            className="mt-1 min-h-10"
            rows={1}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
          Upload evidence
        </Button>
        <p className="text-xs text-muted-foreground">Up to 50MB per file. Stored privately.</p>
      </div>
    </div>
  );
}

function CitationsPanel({
  contractId,
  userId,
  citations,
  onChange,
}: {
  contractId: string;
  userId: string;
  citations: RegulatoryCitation[];
  onChange: () => void;
}) {
  const [citation, setCitation] = useState("");
  const [summary, setSummary] = useState("");
  const [url, setUrl] = useState("");

  const add = async () => {
    if (!citation.trim()) return;
    const { error } = await supabase.from("regulatory_citations").insert({
      user_id: userId,
      contract_id: contractId,
      citation: citation.trim(),
      plain_language_summary: summary.trim() || null,
      official_url: url.trim() || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setCitation("");
    setSummary("");
    setUrl("");
    onChange();
  };

  const toggle = async (c: RegulatoryCitation) => {
    await supabase
      .from("regulatory_citations")
      .update({ reviewed: !c.reviewed, reviewed_at: c.reviewed ? null : new Date().toISOString() })
      .eq("id", c.id);
    onChange();
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <ShieldCheck className="size-4 text-primary" /> Regulatory citations
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The regulations this contract flows down, in plain language, with a review checkbox for each.
      </p>

      <ul className="mt-4 space-y-2">
        {citations.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox checked={c.reviewed} onCheckedChange={() => void toggle(c)} className="mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{c.citation}</p>
              {c.plain_language_summary && (
                <p className="mt-0.5 text-xs text-muted-foreground">{c.plain_language_summary}</p>
              )}
              {c.official_url && (
                <a
                  href={c.official_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs font-semibold text-primary hover:underline"
                >
                  Official text
                </a>
              )}
            </div>
          </li>
        ))}
        {citations.length === 0 && (
          <li className="text-xs text-muted-foreground">No citations recorded yet.</li>
        )}
      </ul>

      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr_1fr_auto]">
        <Input placeholder="2 CFR 200.302" value={citation} onChange={(e) => setCitation(e.target.value)} />
        <Input
          placeholder="What it requires, in plain language"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <Input placeholder="Official link" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button variant="outline" onClick={() => void add()}>
          <Plus className="mr-1 size-4" /> Add
        </Button>
      </div>
    </section>
  );
}

function AgencyPortalPanel({
  contractId,
  userId,
  access,
  onChange,
}: {
  contractId: string;
  userId: string;
  access: { id: string; contact_name: string | null; contact_email: string; status: string; access_count: number; last_accessed_at: string | null }[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const invite = async () => {
    if (!email.trim()) return;
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    const { error } = await supabase.from("agency_portal_access").insert({
      user_id: userId,
      contract_id: contractId,
      contact_name: name.trim() || null,
      contact_email: email.trim(),
      access_token: randomToken(),
      expires_at: expires.toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Agency contact invited (read-only)");
    setName("");
    setEmail("");
    onChange();
  };

  const revoke = async (id: string) => {
    await supabase.from("agency_portal_access").update({ status: "revoked" }).eq("id", id);
    onChange();
  };

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Link2 className="size-4 text-primary" /> Agency Portal access
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Give a contracting officer read-only visibility of this contract's compliance record.
      </p>
      <ul className="mt-4 space-y-2">
        {access.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
          >
            <span>
              {a.contact_name ? `${a.contact_name} · ` : ""}
              {a.contact_email}
              <span className="ml-2 text-xs text-muted-foreground">
                {a.status} · {a.access_count} views
                {a.last_accessed_at ? ` · last ${formatStamp(a.last_accessed_at)}` : ""}
              </span>
            </span>
            {a.status === "active" && (
              <Button size="sm" variant="ghost" onClick={() => void revoke(a.id)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
        {access.length === 0 && <li className="text-xs text-muted-foreground">No external access granted.</li>}
      </ul>
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <Input placeholder="Contact name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Button variant="outline" onClick={() => void invite()}>
          Invite
        </Button>
      </div>
    </section>
  );
}

function PackageActions({
  contract,
  obligations,
  evidence,
  citations,
  packages,
  userId,
  readinessScore,
  onChange,
}: {
  contract: ComplianceContract;
  obligations: ComplianceObligation[];
  evidence: EvidenceFile[];
  citations: RegulatoryCitation[];
  packages: AuditPackage[];
  userId: string;
  readinessScore: number;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const html = () => {
    const rows = obligations
      .map(
        (o) => `<tr><td>${escapeHtml(o.title)}</td><td>${CATEGORY_LABEL[o.category] ?? o.category}</td>
        <td>${formatDate(o.due_date)}</td><td>${STATUS_LABEL[o.status] ?? o.status}</td>
        <td>${evidence.filter((e) => e.obligation_id === o.id).length}</td></tr>`,
      )
      .join("");
    const evidenceRows = evidence
      .map(
        (e) =>
          `<tr><td>${escapeHtml(e.file_name)}</td><td>${escapeHtml(e.document_type)}</td><td>${formatStamp(
            e.upload_timestamp,
          )}</td><td>${escapeHtml(e.uploaded_by_name ?? "")}</td><td class="mono">${escapeHtml(
            e.file_hash ?? "",
          )}</td></tr>`,
      )
      .join("");
    const citationRows = citations
      .map(
        (c) =>
          `<tr><td>${escapeHtml(c.citation)}</td><td>${escapeHtml(
            c.plain_language_summary ?? "",
          )}</td><td>${c.reviewed ? "Reviewed" : "Not reviewed"}</td></tr>`,
      )
      .join("");
    return `<!doctype html><html><head><meta charset="utf-8"><title>Compliance Documentation Package</title>
      <style>body{font-family:system-ui,sans-serif;padding:32px;color:#111}h1{font-size:26px}
      h2{font-size:16px;margin-top:28px;border-bottom:1px solid #ddd;padding-bottom:6px}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
      th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
      th{background:#f4f4f5}.mono{font-family:ui-monospace,monospace;font-size:10px;word-break:break-all}</style></head>
      <body>
      <h1>Compliance Documentation Package</h1>
      <p><strong>${escapeHtml(contract.name)}</strong><br/>${escapeHtml(contract.funder)}${
        contract.contract_number ? ` · Contract ${escapeHtml(contract.contract_number)}` : ""
      }<br/>Period ${formatDate(contract.period_start)} – ${formatDate(contract.period_end)}</p>
      <p>Generated ${formatStamp(new Date().toISOString())} · Audit readiness ${readinessScore}%</p>
      <h2>Obligation records</h2><table><thead><tr><th>Obligation</th><th>Category</th><th>Due</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Evidence index</h2><table><thead><tr><th>File</th><th>Type</th><th>Uploaded (server time)</th><th>Uploaded by</th><th>SHA-256</th></tr></thead><tbody>${evidenceRows}</tbody></table>
      <h2>Regulatory citations</h2><table><thead><tr><th>Citation</th><th>Summary</th><th>Review</th></tr></thead><tbody>${citationRows}</tbody></table>
      </body></html>`;
  };

  const record = async (format: string, token: string | null) => {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    await supabase.from("audit_packages").insert({
      user_id: userId,
      contract_id: contract.id,
      format,
      share_link_token: token,
      expires_at: token ? expires.toISOString() : null,
      snapshot: {
        readiness: readinessScore,
        obligations: obligations.length,
        evidence: evidence.length,
        generated_at: new Date().toISOString(),
      },
    });
    onChange();
  };

  const generatePdf = async () => {
    setBusy(true);
    printHtml(html());
    await record("pdf", null);
    setBusy(false);
  };

  const generateHtmlFile = async () => {
    setBusy(true);
    downloadFile(html(), `compliance-package-${contract.id}.html`, "text/html");
    await record("html", null);
    setBusy(false);
  };

  const generateShareLink = async () => {
    const token = randomToken();
    await record("pdf", token);
    await navigator.clipboard
      .writeText(`${window.location.origin}/audit/share/${token}`)
      .catch(() => undefined);
    toast.success("Read-only link created and copied");
  };

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void generatePdf()} disabled={busy}>
        <FileDown className="mr-2 size-4" /> Compliance package (PDF)
      </Button>
      <Button variant="outline" onClick={() => void generateHtmlFile()} disabled={busy}>
        <FileCheck2 className="mr-2 size-4" /> Download package file
      </Button>
      <Button variant="ghost" onClick={() => void generateShareLink()}>
        <Link2 className="mr-2 size-4" /> Create read-only link
      </Button>
      <p className="text-xs text-muted-foreground">
        {packages.length} package{packages.length === 1 ? "" : "s"} generated
      </p>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}
