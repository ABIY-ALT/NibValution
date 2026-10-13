import Link from 'next/link';
import { FileSearch } from 'lucide-react';
import { StatusBadge } from '@/components/workflow/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  EmptyRow,
  TBody,
  TD,
  TDNum,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import { formatAmount } from '@/lib/money';
import type { CaseStatus, SiteVisitCheck } from '@/server/domain/shared/enums';
import { summarizeVisits } from '@/server/domain/site-visit/location-check';
import { VisitSummaryBadge } from '@/components/valuation/site-visit-check';

export interface CaseRow {
  id: string;
  caseNumber: string;
  status: string;
  discipline: string;
  applicantName: string;
  ownerName: string;
  finalValue: { toString(): string } | null;
  createdAt: Date;
  requestedAt: Date | null;
  requestType: { name: string };
  requestingOrg: { name: string };
  maker: { fullName: string } | null;
  checker: { fullName: string } | null;
  slaRecord: { status: string; dueAt: Date } | null;
  /** Present when the query loaded them; needed only for the site-visit column. */
  siteVisits?: { locationCheck: SiteVisitCheck }[];
}

function formatDate(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(value);
}

function slaBadge(sla: CaseRow['slaRecord']) {
  if (!sla) return null;
  const overdue = sla.status === 'BREACHED' || sla.dueAt.getTime() < Date.now();
  if (overdue) {
    const days = Math.max(1, Math.ceil((Date.now() - sla.dueAt.getTime()) / 86_400_000));
    return <Badge variant="danger">{days}d overdue</Badge>;
  }
  if (sla.status === 'WARNING') return <Badge variant="warning">Due soon</Badge>;
  return null;
}

/**
 * One case table, shared by the request list and every work-queue view.
 *
 * Keeping it in one component means a column added for the archive appears in
 * the queues too, and a reader learns the layout once.
 */
export function CaseTable({
  rows,
  emptyMessage,
  emptyTitle = 'Nothing to show',
  emptyAction,
  showSla = true,
  showSiteVisit = false,
  title,
  meta,
}: {
  rows: CaseRow[];
  emptyMessage: string;
  emptyTitle?: string;
  emptyAction?: React.ReactNode;
  showSla?: boolean;
  /** Adds the site-visit column; the rows must carry their visits. */
  showSiteVisit?: boolean;
  /** Masthead title. Omitted, the register renders without a masthead. */
  title?: string;
  /** Counts or controls shown at the right of the masthead. */
  meta?: React.ReactNode;
}) {
  return (
    <TableWrap>
      {title ? (
        <TableBar>
          <TableTitle>{title}</TableTitle>
          {meta ? <div className="flex items-center gap-2">{meta}</div> : null}
        </TableBar>
      ) : null}

      <TableScroll>
        <Table>
          <THead>
            <TR>
              <TH>Case number</TH>
              <TH>Type</TH>
              <TH>Owner / applicant</TH>
              <TH>Requesting unit</TH>
              <TH>Maker / checker</TH>
              {showSiteVisit ? <TH>Site visit</TH> : null}
              <TH>Status</TH>
              <TH className="text-right">Value (ETB)</TH>
              <TH>Raised</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <EmptyRow
                colSpan={showSiteVisit ? 9 : 8}
                icon={FileSearch}
                title={emptyTitle}
                action={emptyAction}
              >
                {emptyMessage}
              </EmptyRow>
            ) : (
              rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link
                      href={`/requests/${row.id}`}
                      className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                    >
                      {row.caseNumber}
                    </Link>
                    <span className="block text-[11px] text-ink-3">
                      {row.discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}
                    </span>
                  </TD>
                  <TD className="text-[13px]">{row.requestType.name}</TD>
                  <TD className="text-[13px]">
                    <span className="font-medium">{row.ownerName}</span>
                    <span className="block text-[11px] text-ink-3">{row.applicantName}</span>
                  </TD>
                  <TD className="text-[13px]">{row.requestingOrg.name}</TD>
                  <TD className="text-[13px]">
                    {row.maker?.fullName ?? <span className="text-ink-3">Unassigned</span>}
                    <span className="block text-[11px] text-ink-3">
                      {row.checker?.fullName ?? '—'}
                    </span>
                  </TD>
                  {showSiteVisit ? (
                    <TD>
                      {/* No valuator yet means no visit is due. */}
                      {row.maker ? (
                        <VisitSummaryBadge
                          summary={summarizeVisits(
                            (row.siteVisits ?? []).map((v) => v.locationCheck),
                          )}
                        />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TD>
                  ) : null}
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={row.status as CaseStatus} />
                      {showSla ? slaBadge(row.slaRecord) : null}
                    </div>
                  </TD>
                  <TDNum className="text-[13px]">
                    {row.finalValue ? formatAmount(row.finalValue.toString()) : '—'}
                  </TDNum>
                  <TD className="whitespace-nowrap text-[12px] text-ink-2">
                    {formatDate(row.requestedAt ?? row.createdAt)}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </TableScroll>
    </TableWrap>
  );
}
