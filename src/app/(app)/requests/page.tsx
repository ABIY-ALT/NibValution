import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listCases } from '@/server/application/case-service';
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
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/input';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { caseFilterSchema } from '@/lib/validation/case';
import { CASE_STATUSES, CASE_STATUS_LABELS } from '@/server/domain/shared/enums';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const raw = await searchParams;

  // Unknown or malformed filters are dropped rather than rejected: a stale
  // bookmark should show the list, not an error page.
  const parsed = caseFilterSchema.safeParse(raw);
  const filter = parsed.success ? parsed.data : {};

  const result = await listCases(actor, { ...filter, pageSize: LIST_PAGE_SIZE });
  const canCreate = actor.permissions.has(PERMISSIONS.CASE_CREATE);
  const isFiltered = Boolean(filter.search || filter.status || filter.discipline);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Valuation"
        title="Valuation Requests"
        subtitle="Every case you are authorised to see, newest first. The list and the counts share one scope filter, so what you can see here is exactly what you can open."
        actions={
          <>
            <Badge variant="brand" size="lg">
              {result.total} cases
            </Badge>
            {canCreate ? (
              <Button asChild>
                <Link href="/requests/new">
                  <FilePlus2 aria-hidden="true" />
                  New request
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar clearHref={isFiltered ? '/requests' : undefined}>
        <SearchField
          defaultValue={filter.search ?? ''}
          placeholder="Case no., owner, applicant, LHC, plate, chassis or serial"
        />

        <Field label="Status" htmlFor="status" className="w-full sm:w-56">
          <Select id="status" name="status" defaultValue={filter.status ?? ''}>
            <option value="">All statuses</option>
            {CASE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CASE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Discipline" htmlFor="discipline" className="w-full sm:w-44">
          <Select id="discipline" name="discipline" defaultValue={filter.discipline ?? ''}>
            <option value="">Both</option>
            <option value="CIVIL">Civil</option>
            <option value="MECHANICAL">Mechanical</option>
          </Select>
        </Field>
      </FilterBar>

      <CaseTable
        title="Case register"
        meta={<Badge variant="default">{result.rows.length} shown</Badge>}
        rows={result.rows}
        emptyTitle={isFiltered ? 'No matching cases' : 'No requests yet'}
        emptyMessage={
          isFiltered
            ? 'No cases match these filters. Try widening the status or discipline.'
            : 'No valuation requests have been raised yet.'
        }
        emptyAction={
          canCreate && !isFiltered ? (
            <Button asChild size="sm">
              <Link href="/requests/new">
                <FilePlus2 aria-hidden="true" />
                Raise the first request
              </Link>
            </Button>
          ) : null
        }
      />

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        noun="cases"
        pageSize={result.pageSize}
        buildHref={(page) => pageHref('/requests', filter, page)}
      />
    </div>
  );
}
