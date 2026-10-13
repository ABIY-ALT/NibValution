import { MessageSquareWarning } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCases } from '@/server/application/case-service';
import { PageHero } from '@/components/layout/page-hero';
import { LIST_PAGE_SIZE, Pagination, pageHref, readPage } from '@/components/layout/list-controls';
import { CaseTable } from '@/components/cases/case-table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';

export const dynamic = 'force-dynamic';

export default async function ReturnedCasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const { page } = await searchParams;

  // A Maker sees their own rework; a manager sees the department's, because the
  // department view is what shows whether rework is concentrated somewhere.
  const isValuator =
    actor.permissions.has(PERMISSIONS.VALUATION_SUBMIT) &&
    !actor.permissions.has(PERMISSIONS.CASE_ASSIGN_MAKER);

  const result = await listCases(actor, {
    status: 'RETURNED_FOR_CORRECTION',
    mineOnly: isValuator,
    page: readPage(page),
    pageSize: LIST_PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Work Queue"
        title="Returned Cases"
        subtitle={
          isValuator
            ? 'Cases returned to you for correction. Each carries the comment explaining what must change.'
            : 'Cases returned for correction across your department, with the rework still open.'
        }
        actions={
          <Badge variant={result.total > 0 ? 'danger' : 'success'} size="lg">
            {result.total} open
          </Badge>
        }
      />

      {result.total > 0 ? (
        <Alert variant="warning">
          <MessageSquareWarning aria-hidden="true" />
          <AlertTitle>Every return carries a reason</AlertTitle>
          <AlertDescription>
            Open a case to read the correction comment and its full history. Rework is measured
            separately from the case clock, so repeated returns stay visible.
          </AlertDescription>
        </Alert>
      ) : null}

      <CaseTable
        title="Open corrections"
        meta={<Badge variant="default">{result.rows.length} shown</Badge>}
        rows={result.rows}
        emptyTitle="No open rework"
        emptyMessage="Nothing is currently returned for correction."
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        noun="cases"
        buildHref={(p) => pageHref('/tasks/returned', {}, p)}
      />
    </div>
  );
}
