import { Lock } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCases } from '@/server/application/case-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import {
  FilterBar,
  LIST_PAGE_SIZE,
  Pagination,
  SearchField,
  pageHref,
} from '@/components/layout/list-controls';
import { CaseTable } from '@/components/cases/case-table';
import { Badge } from '@/components/ui/badge';
import { Field, Select } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { caseFilterSchema } from '@/lib/validation/case';

export const dynamic = 'force-dynamic';

export default async function ArchivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();

  if (!actor.permissions.has(PERMISSIONS.ARCHIVE_SEARCH)) {
    return <AccessDenied permission="archive:search" what="the closed archive" />;
  }

  const raw = await searchParams;
  const parsed = caseFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : {};

  // Closed work: completed, archived and cancelled. Archived records stay
  // searchable, and the scope filter still applies (spec section 24).
  const result = await listCases(actor, {
    ...filter,
    statuses: ['COMPLETED', 'ARCHIVED', 'CANCELLED'],
    pageSize: LIST_PAGE_SIZE,
  });

  const isFiltered = Boolean(filter.search || filter.discipline);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Valuation"
        title="Closed Archive"
        subtitle="Completed, archived and cancelled cases. Historical records are retained for audit and reference, and remain searchable within your permissions."
        actions={
          <Badge variant="brand" size="lg">
            {result.total} records
          </Badge>
        }
      />

      <Alert variant="info">
        <Lock aria-hidden="true" />
        <AlertTitle>Archived records are read-only</AlertTitle>
        <AlertDescription>
          An approved valuation is never edited or deleted. A correction after approval creates a
          new, controlled version rather than altering the record kept here.
        </AlertDescription>
      </Alert>

      <FilterBar clearHref={isFiltered ? '/archive' : undefined}>
        <SearchField
          defaultValue={filter.search ?? ''}
          placeholder="Case no., owner, applicant, LHC, plate, chassis or serial"
        />

        <Field label="Discipline" htmlFor="discipline" className="w-full sm:w-44">
          <Select id="discipline" name="discipline" defaultValue={filter.discipline ?? ''}>
            <option value="">Both</option>
            <option value="CIVIL">Civil</option>
            <option value="MECHANICAL">Mechanical</option>
          </Select>
        </Field>
      </FilterBar>

      <CaseTable
        title="Closed records"
        meta={<Badge variant="default">{result.rows.length} shown</Badge>}
        rows={result.rows}
        showSla={false}
        emptyTitle={isFiltered ? 'No matching records' : 'Archive is empty'}
        emptyMessage={
          isFiltered
            ? 'No archived cases match this search.'
            : 'No cases have been completed or archived yet.'
        }
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        noun="records"
        pageSize={result.pageSize}
        buildHref={(page) => pageHref('/archive', filter, page)}
      />
    </div>
  );
}
