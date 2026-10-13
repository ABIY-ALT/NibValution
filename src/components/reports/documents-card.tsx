import Link from 'next/link';
import { ChevronRight, FileSignature, FileText, Mail } from 'lucide-react';
import type { CaseDocumentEntry } from '@/server/application/case-document-service';
import { Badge } from '@/components/ui/badge';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';

const KINDS = {
  VALUATION: { label: 'Valuation report', icon: FileSignature },
  COVER_PAGE: { label: 'Cover page', icon: FileText },
  FINAL_LETTER: { label: 'Final letter', icon: Mail },
} as const;

const STAMP = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** The case's issued documents, newest first; each opens in the print-ready viewer. */
export function DocumentsCard({
  caseId,
  documents,
}: {
  caseId: string;
  documents: CaseDocumentEntry[];
}) {
  return (
    <Card className="overflow-hidden">
      <CardBar>
        <CardTitle className="flex items-center gap-3">
          <CardIcon icon={FileText} />
          Reports
        </CardTitle>
      </CardBar>
      <CardContent className="pt-4">
        <ul className="divide-y divide-line">
          {documents.map((doc) => {
            const kind = KINDS[doc.type];
            const Icon = kind.icon;
            return (
              <li key={doc.id}>
                <Link
                  href={`/requests/${caseId}/reports/${doc.id}`}
                  className="group flex items-center gap-3 py-3 transition-colors"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) bg-nib-gold-500/15 text-nib-gold-700 dark:text-nib-gold-400">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink group-hover:text-nib-gold-800 dark:group-hover:text-nib-gold-400">
                      {kind.label}
                      <Badge size="sm" variant="default">
                        v{doc.version}
                      </Badge>
                      {doc.signed ? (
                        <Badge size="sm" variant="success">
                          Signed
                        </Badge>
                      ) : null}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-3">
                      {doc.generatedBy} · {STAMP.format(doc.generatedAt)}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
