import { useRef, useState } from "react";
import { Download, FileText, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDeleteDocument,
  useDocuments,
  useDownloadDocument,
  useUploadDocument,
} from "@/lib/hooks";
import { ACCEPTED_UPLOAD_TYPES } from "@/lib/types";
import { cn } from "@/lib/utils";

// Source documents for a contract. Uploading replaces the contract body, which
// is what the AI analyzes — so this panel is the primary way text gets in.

export function DocumentPanel({ contractId }: { contractId: string }) {
  const { data: documents, isLoading } = useDocuments(contractId);
  const upload = useUploadDocument(contractId);
  const remove = useDeleteDocument(contractId);
  const download = useDownloadDocument(contractId);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const rows = documents ?? [];
  const error = (upload.error ?? remove.error ?? download.error) as Error | null;

  const send = (files: FileList | null) => {
    const file = files?.[0];
    if (file) upload.mutate(file);
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border p-5">
        <h3 className="font-bold text-foreground">Source documents</h3>
        <p className="text-sm text-muted-foreground">
          PDF, DOCX, TXT or MD. The latest upload becomes the text we analyze.
        </p>
      </div>

      <div className="p-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            send(e.dataTransfer.files);
          }}
          className={cn(
            "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-border",
          )}
        >
          {upload.isPending ? (
            <>
              <Loader2 className="mx-auto size-6 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">
                Uploading and extracting text…
              </p>
            </>
          ) : (
            <>
              <Upload className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-foreground">
                Drag a contract here, or{" "}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="font-semibold text-primary underline-offset-2 hover:underline"
                >
                  browse
                </button>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Scanned images need OCR before upload.
              </p>
            </>
          )}

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_UPLOAD_TYPES}
            className="sr-only"
            onChange={(e) => {
              send(e.target.files);
              // Reset so re-selecting the same file still fires a change event.
              e.target.value = "";
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error.message}
          </div>
        )}

        {isLoading ? (
          <div className="mt-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? null : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {rows.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 p-3">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {doc.filename}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(doc.byte_size)} ·{" "}
                    {doc.extracted_chars.toLocaleString()} characters extracted
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Download"
                  disabled={download.isPending}
                  onClick={() =>
                    download.mutate({ id: doc.id, filename: doc.filename })
                  }
                >
                  <Download className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Remove"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(doc.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
