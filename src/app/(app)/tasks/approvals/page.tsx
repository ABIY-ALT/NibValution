import { Scale } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCases } from '@/server/application/case-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { LIST_PAGE_SIZE, Pagination, pageHref, readPage } from '@/components/layout/list-controls';
import { CaseTable } from '@/components/cases/case-table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';

export const dynamic = 'force-dynamic';

export default async function PendingApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const { page } = await searchParams;

  const canApproveAsManager = actor.permissions.has(PERMISSIONS.APPROVAL_MANAGER);
  const canApproveAsDirector = actor.permissions.has(PERMISSIONS.APPROVAL_DIRECTOR);

  if (!canApproveAsManager && !canApproveAsDirector) {
    return <AccessDenied permission="approval:manager" what="the approval queue" />;
  }

  // Show only the gate this actor can actually act at. A Manager seeing cases
  // that await the Director would be a queue they cannot clear.
  const statuses = [
    ...(canApproveAsManager ? (['PENDING_MANAGER_APPROVAL'] as const) : []),
    ...(canApproveAsDirector ? (['PENDING_DIRECTOR_APPROVAL'] as const) : []),
  ];

  const result = await listCases(actor, {
    statuses,
    page: readPage(page),
    pageSize: LIST_PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Work Queue"
        title="Pending Approvals"
        subtitle="Cases awaiting your decision. The approval chain is resolved from the configured thresholds, so a case appears here only when it is genuinely your turn."
        actions={
          <Badge variant={result.total > 0 ? 'warning' : 'success'} size="lg">
            {result.total} awaiting
          </Badge>
        }
      />

      <Alert variant="info">
        <Scale aria-hidden="true" />
        <AlertTitle>Segregation of duties still applies</AlertTitle>
        <AlertDescription>
          A case you valued or checked yourself will not offer you an approval action, even though
          it is listed in your department.
        </AlertDescription>
      </Alert>

      <CaseTable
        title="Awaiting your decision"
        meta={<Badge variant="default">{result.rows.length} shown</Badge>}
        rows={result.rows}
        emptyTitle="Your queue is clear"
        emptyMessage="Nothing is awaiting your approval."
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        noun="cases"
        buildHref={(p) => pageHref('/tasks/approvals', {}, p)}
      />
    </div>
  );
}
