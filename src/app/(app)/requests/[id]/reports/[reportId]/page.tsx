import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ShieldAlert, ShieldCheck } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { loadCaseDocument } from '@/server/application/case-document-service';
import { loadApprovalRecord } from '@/server/application/signature-service';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PrintButton } from '@/components/reports/print-button';
import {
  CoverPageDocument,
  FinalLetterDocument,
  ValuationReportDocument,
} from '@/components/reports/documents';
import { NotFoundError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const TITLES = {
  VALUATION: 'Valuation report',
  COVER_PAGE: 'Cover page',
  FINAL_LETTER: 'Final letter',
} as const;

const SIGNATURE_LABELS: Record<string, string> = {
  VALID: 'Signature valid',
  DOCUMENT_CHANGED: 'Document altered after signing',
  INVALID: 'Signature invalid',
  UNKNOWN_KEY: 'Signed with a key this server does not hold',
  REVOKED: 'Signature revoked',
};

/**
 * One case document, rendered from its frozen snapshot. The toolbar is screen
 * only; printing (or "Save as PDF") produces the document alone on A4.
 */
export default async function CaseDocumentPage({
  params,
}: {
  params: Promise<{ id: string; reportId: string }>;
}) {
  const actor = await requireActor();
  const { id, reportId } = await params;

  const report = await loadCaseDocument(actor, id, reportId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  let signatureStatus: string | null = null;
  if (report.type === 'VALUATION') {
    const record = await loadApprovalRecord(actor, id);
    if (record?.signature && record.signature.reportVersion === report.version) {
      signatureStatus = SIGNATURE_LABELS[record.signature.check] ?? record.signature.check;
    }
  }

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/requests/${id}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {report.caseNumber}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-bold tracking-tight text-ink">{TITLES[report.type]}</h1>
            <Badge variant="default">Version {report.version}</Badge>
            {report.intact ? (
              <Badge variant="success">
                <ShieldCheck aria-hidden="true" />
                Unaltered
              </Badge>
            ) : (
              <Badge variant="danger">
                <ShieldAlert aria-hidden="true" />
                Altered
              </Badge>
            )}
          </div>
        </div>
        <PrintButton />
      </div>

      {!report.intact ? (
        <Alert variant="destructive" className="no-print">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>This document no longer matches its fingerprint</AlertTitle>
          <AlertDescription>
            The stored content has changed since it was issued. Do not rely on it; report it to the
            system administrator.
          </AlertDescription>
        </Alert>
      ) : null}

      <article className="paper print-sheet mx-auto w-full max-w-[210mm] rounded-(--radius-card) p-[14mm] shadow-card">
        {report.type === 'COVER_PAGE' ? (
          <CoverPageDocument doc={report.document} fingerprint={report.sha256} />
        ) : report.type === 'FINAL_LETTER' ? (
          <FinalLetterDocument doc={report.document} fingerprint={report.sha256} />
        ) : (
          <ValuationReportDocument
            doc={report.document}
            fingerprint={report.sha256}
            signatureStatus={signatureStatus}
          />
        )}
      </article>
    </div>
  );
}
