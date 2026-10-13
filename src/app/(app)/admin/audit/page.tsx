import { Fragment } from 'react';
import Link from 'next/link';
import { Lock, ScrollText } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listAuditLog } from '@/server/application/admin-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { FilterBar, Pagination } from '@/components/layout/list-controls';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Field, Select } from '@/components/ui/input';
import {
  EmptyRow,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import {
  AUDIT_CATEGORIES,
  auditActionLabel,
  auditEntityLabel,
  describeAudit,
  roleNames,
} from '@/lib/audit-describe';

export const dynamic = 'force-dynamic';

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const TIME = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'UTC' });

const LOOPBACK = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

/** The heading for a day's records, with today and yesterday named as such. */
function dayHeading(value: Date, now: Date): string {
  const key = (date: Date) => date.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const label = DAY.format(value);
  if (key(value) === key(now)) return `Today · ${label}`;
  if (key(value) === key(yesterday)) return `Yesterday · ${label}`;
  return label;
}

/** Filter options named for a reader, in alphabetical order of that name. */
function options(codes: string[], label: (code: string) => string) {
  return codes
    .map((code) => ({ value: code, label: label(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; entity?: string; page?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.AUDIT_READ)) {
    return <AccessDenied permission="audit:read" what="the audit log" />;
  }
  const params = await searchParams;

  const result = await listAuditLog(actor, {
    action: params.action || undefined,
    entity: params.entity || undefined,
    page: Number(params.page) || 1,
  });

  const isFiltered = Boolean(params.action || params.entity);
  const now = new Date();
  const lookups = { caseNumbers: result.caseNumbers, userNames: result.userNames };
  const firstShown = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastShown = (result.page - 1) * result.pageSize + result.rows.length;

  const buildHref = (page: number) => {
    const next = new URLSearchParams();
    const merged = { action: params.action, entity: params.entity, page: String(page) };
    for (const [key, value] of Object.entries(merged)) {
      if (value) next.set(key, value);
    }
    const query = next.toString();
    return query ? `/admin/audit?${query}` : '/admin/audit';
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Audit Log"
        subtitle="Who did what, and when. Every sign-in, case step and settings change is recorded here, newest first."
        actions={
          <Badge variant="brand" size="lg">
            {result.total.toLocaleString()} records
          </Badge>
        }
      />

      <Alert variant="info">
        <Lock aria-hidden="true" />
        <AlertTitle>A permanent record</AlertTitle>
        <AlertDescription>
          Entries can never be edited or deleted — not by an administrator, and not by the
          application itself. All times are in UTC.
        </AlertDescription>
      </Alert>

      <FilterBar clearHref={isFiltered ? '/admin/audit' : undefined}>
        <Field label="What happened" htmlFor="action" className="w-full sm:w-64">
          <Select id="action" name="action" defaultValue={params.action ?? ''}>
            <option value="">Everything</option>
            {options(result.actions, auditActionLabel).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Record type" htmlFor="entity" className="w-full sm:w-64">
          <Select id="entity" name="entity" defaultValue={params.entity ?? ''}>
            <option value="">All record types</option>
            {options(result.entities, auditEntityLabel).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <ScrollText className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Activity
          </TableTitle>
          <Badge variant="default">
            {result.total === 0
              ? 'No records'
              : `Showing ${firstShown.toLocaleString()}–${lastShown.toLocaleString()} of ${result.total.toLocaleString()}`}
          </Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH className="w-24">Time</TH>
                <TH>Who</TH>
                <TH>What happened</TH>
                <TH>Case</TH>
                <TH>From</TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <EmptyRow
                  colSpan={5}
                  icon={ScrollText}
                  title={isFiltered ? 'No matching records' : 'No audit records yet'}
                >
                  {isFiltered
                    ? 'Nothing matches these filters. Try “Everything” or clear the filters.'
                    : 'Records appear here as users sign in and act on cases.'}
                </EmptyRow>
              ) : (
                result.rows.map((row, index) => {
                  const described = describeAudit(row, lookups);
                  const category = AUDIT_CATEGORIES[described.category];
                  const previous = result.rows[index - 1];
                  const startsDay =
                    !previous ||
                    previous.occurredAt.toISOString().slice(0, 10) !==
                      row.occurredAt.toISOString().slice(0, 10);
                  const roles = roleNames(row.actorRole);

                  return (
                    <Fragment key={row.id}>
                      {startsDay ? (
                        <tr className="bg-surface-2/70">
                          <td
                            colSpan={5}
                            className="px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-3"
                          >
                            {dayHeading(row.occurredAt, now)}
                          </td>
                        </tr>
                      ) : null}

                      <TR>
                        <TD className="tabular whitespace-nowrap align-top text-[12px] text-ink-2">
                          {TIME.format(row.occurredAt)}
                        </TD>

                        <TD className="align-top text-[12px]">
                          <div className="max-w-[13rem]">
                            {row.actor ? (
                              <>
                                <span
                                  className="block truncate font-semibold text-ink"
                                  title={row.actor.fullName}
                                >
                                  {row.actor.fullName}
                                </span>
                                <span
                                  className="block truncate text-[11px] text-ink-3"
                                  title={row.actor.employeeId}
                                >
                                  {roles ?? row.actor.employeeId}
                                </span>
                              </>
                            ) : (
                              <span className="text-[11.5px] italic text-ink-3">
                                Someone not signed in
                              </span>
                            )}
                          </div>
                        </TD>

                        <TD className="align-top">
                          <div className="flex min-w-[18rem] items-start gap-2.5">
                            <Badge variant={category.tone} size="sm" className="mt-px shrink-0">
                              {category.label}
                            </Badge>
                            <div className="min-w-0">
                              <p className="text-[12.5px] font-semibold leading-snug text-ink">
                                {described.summary}
                              </p>
                              {described.detail ? (
                                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">
                                  {described.detail}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </TD>

                        <TD className="whitespace-nowrap align-top text-[12px]">
                          {described.caseId && described.caseNumber ? (
                            <Link
                              href={`/requests/${described.caseId}`}
                              className="tabular font-semibold text-nib-gold-700 hover:underline dark:text-nib-gold-400"
                            >
                              {described.caseNumber}
                            </Link>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </TD>

                        <TD
                          className="tabular whitespace-nowrap align-top text-[11.5px] text-ink-3"
                          title={
                            row.correlationId
                              ? `Request reference ${row.correlationId}. Records with the same reference came from one action.`
                              : undefined
                          }
                        >
                          {row.ipAddress
                            ? LOOPBACK.has(row.ipAddress)
                              ? 'This server'
                              : row.ipAddress
                            : '—'}
                        </TD>
                      </TR>
                    </Fragment>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        noun="records"
        buildHref={buildHref}
      />
    </div>
  );
}
