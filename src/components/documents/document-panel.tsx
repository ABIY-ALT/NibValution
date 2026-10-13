'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Download, FileText, Trash2, Upload } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface DocumentItem {
  id: string;
  filename: string;
  categoryName: string;
  categoryCode: string;
  isMandatory: boolean;
  sizeBytes: number;
  version: number;
  scanStatus: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface CategoryOption {
  code: string;
  name: string;
  isMandatory: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Supporting documents for a case.
 *
 * Drag-and-drop with a visible file picker fallback (§8). Upload goes to the
 * API route rather than a server action because a server action's body limit is
 * sized for form fields, not for a 25 MB scan.
 *
 * A rejected file reports exactly why, per file — a multi-file drop where one
 * item is a renamed executable keeps the rest.
 */
export function DocumentPanel({
  caseId,
  documents,
  categories,
  missing,
  canUpload,
  canDelete,
}: {
  caseId: string;
  documents: DocumentItem[];
  categories: CategoryOption[];
  missing: { code: string; name: string }[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [category, setCategory] = useState(categories[0]?.code ?? '');
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(files: FileList | File[]) {
    if (!category) {
      setErrors(['Choose a document category first.']);
      return;
    }

    setBusy(true);
    setErrors([]);
    setNotice(null);

    const form = new FormData();
    form.set('caseId', caseId);
    form.set('categoryCode', category);
    for (const file of Array.from(files)) form.append('file', file);

    try {
      const response = await fetch('/api/documents/upload', { method: 'POST', body: form });
      const body = (await response.json()) as {
        uploaded?: { filename: string; quarantined: boolean }[];
        rejected?: { filename: string; reason: string }[];
        detail?: string;
      };

      if (!response.ok && !body.uploaded?.length) {
        setErrors([body.detail ?? 'The upload was refused.']);
      }
      if (body.rejected?.length) {
        setErrors((prev) => [...prev, ...body.rejected!.map((r) => `${r.filename}: ${r.reason}`)]);
      }
      if (body.uploaded?.length) {
        const quarantined = body.uploaded.filter((u) => u.quarantined).length;
        setNotice(
          quarantined > 0
            ? `${body.uploaded.length} file(s) stored; ${quarantined} held pending a malware scan.`
            : `${body.uploaded.length} file(s) attached.`,
        );
        startTransition(() => router.refresh());
      }
    } catch {
      setErrors(['The upload could not be sent. Check your connection and try again.']);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove(id: string, filename: string) {
    const reason = window.prompt(
      `Removing "${filename}" is recorded against your name. Why is it being removed? (10 characters minimum)`,
    );
    if (reason === null) return;

    setBusy(true);
    setErrors([]);
    try {
      const response = await fetch(`/api/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { detail?: string };
        setErrors([body.detail ?? 'The document could not be removed.']);
      } else {
        setNotice('Document removed. The file itself is retained for audit.');
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {missing.length > 0 ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertDescription>
            Still required before this case can be submitted:{' '}
            <strong>{missing.map((m) => m.name).join(', ')}</strong>.
          </AlertDescription>
        </Alert>
      ) : null}

      {errors.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <Alert variant="success">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      {canUpload ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="categoryCode" required className="text-[12px] font-semibold">
              Document category
            </Label>
            <select
              id="categoryCode"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="h-9 w-full rounded-control border border-line bg-surface px-2.5 text-[13px]"
            >
              {categories.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                  {option.isMandatory ? ' (required)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              if (event.dataTransfer.files.length > 0) void send(event.dataTransfer.files);
            }}
            className={cn(
              'rounded-card border-2 border-dashed p-6 text-center transition-colors',
              dragging
                ? 'border-nib-gold-500 bg-nib-gold-500/10'
                : 'border-line-strong bg-surface-2 hover:border-nib-gold-500/50',
            )}
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-nib-gold-500/15 text-nib-gold-700 dark:text-nib-gold-400">
              <Upload className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-[13px] font-medium text-ink">Drag files here, or</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={busy || pending}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? 'Uploading…' : 'Choose files'}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="sr-only"
              accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.docx,.xlsx"
              onChange={(event) => {
                if (event.target.files?.length) void send(event.target.files);
              }}
            />
            <p className="mt-2 text-[11px] text-ink-3">
              PDF, JPEG, PNG, TIFF, Word or Excel. Each file is scanned before it becomes
              downloadable.
            </p>
          </div>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <p className="text-[12px] text-ink-3">No documents have been attached yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-card border border-line">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center gap-3 px-3.5 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) bg-nib-gold-500/15 text-nib-gold-700 dark:text-nib-gold-400">
                <FileText className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{document.filename}</p>
                <p className="text-[11px] text-ink-3">
                  {document.categoryName} · {formatSize(document.sizeBytes)}
                  {document.version > 1 ? ` · v${document.version}` : ''} · {document.uploadedBy}
                </p>
              </div>

              {document.scanStatus === 'CLEAN' ? (
                <Button asChild size="sm" variant="ghost" title="Download">
                  <a href={`/api/documents/${document.id}/download`}>
                    <Download className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Download {document.filename}</span>
                  </a>
                </Button>
              ) : (
                <Badge variant="warning">{document.scanStatus}</Badge>
              )}

              {canDelete ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void remove(document.id, document.filename)}
                  title="Remove"
                >
                  <Trash2 className="h-4 w-4 text-st-late" aria-hidden />
                  <span className="sr-only">Remove {document.filename}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
