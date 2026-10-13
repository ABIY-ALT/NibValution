import { CheckCircle2, CalendarClock } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCases } from '@/server/application/case-service';
import { PageHero } from '@/components/layout/page-hero';
import { LIST_PAGE_SIZE, Pagination, pageHref, readPage } from '@/components/layout/list-controls';
import { CaseTable } from '@/components/cases/case-table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { loadSlaPolicy } from '@/server/application/configuration-service';

export const dynamic = 'force-dynamic';

export default async function OverdueCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const { page } = await searchParams;

  const [result, policy] = await Promise.all([
    listCases(actor, { overdueOnly: true, page: readPage(page), pageSize: LIST_PAGE_SIZE }),
    loadSlaPolicy().catch(() => null),
  ]);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Work Queue"
        title="Overdue Cases"
        subtitle={
          policy
            ? `Cases past the ${policy.totalWorkingDays} working-day turnaround standard and not yet completed.`
            : 'Cases past their turnaround standard and not yet completed.'
        }
        actions={
          <Badge variant={result.total > 0 ? 'danger' : 'success'} size="lg">
            {result.total} breached
          </Badge>
        }
      />

      {result.total === 0 ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Nothing is overdue</AlertTitle>
          <AlertDescription>
            Every open case in your scope is still within its turnaround standard.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CalendarClock aria-hidden="true" />
          <AlertTitle>
            {result.total} {result.total === 1 ? 'case has' : 'cases have'} breached the SLA
          </AlertTitle>
          <AlertDescription>
            The due date is computed on working days against the configured calendar, so weekends
            and public holidays do not count against a valuator.
          </AlertDescription>
        </Alert>
      )}

      <CaseTable
        title="Breached turnaround"
        meta={<Badge variant="default">{result.rows.length} shown</Badge>}
        rows={result.rows}
        emptyTitle="All within standard"
        emptyMessage="No overdue cases."
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        noun="cases"
        buildHref={(p) => pageHref('/tasks/overdue', {}, p)}
      />
    </div>
  );
}
