import Link from 'next/link';
import { Building2, ExternalLink, FileSpreadsheet, Layers, MapPin } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import {
  FilterBar,
  LIST_PAGE_SIZE,
  Pagination,
  SearchField,
  pageHref,
  readPage,
} from '@/components/layout/list-controls';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { listCivilRegister } from '@/server/application/property-register-service';
import { formatAmount } from '@/lib/money';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

export const dynamic = 'force-dynamic';

export default async function CivilPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.VALUATION_READ)) {
    return <AccessDenied permission="valuation:read" what="civil property records" />;
  }

  const { q, page } = await searchParams;
  const register = await listCivilRegister(actor, {
    search: q,
    page: readPage(page),
    pageSize: LIST_PAGE_SIZE,
  });
  const { rows, summary } = register;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Valuation"
        title="Civil Properties Registry"
        subtitle="Schedule of collateral land holdings, buildings and civil structures registered across valuation cases."
        actions={
          <Button asChild variant="outline">
            <Link href="/requests/new">
              <Building2 aria-hidden="true" />
              New valuation request
            </Link>
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          label="Properties"
          value={summary.properties}
          caption="Civil collaterals you can see"
          icon={Building2}
          tone="brand"
        />
        <StatCard
          label="Buildings"
          value={summary.buildings}
          caption="Registered structures"
          icon={Layers}
        />
        <StatCard
          label="Plot area"
          value={formatAmount(summary.plotArea).replace(/.00$/, '')}
          unit="m²"
          caption="Across these properties"
          icon={FileSpreadsheet}
        />
        <StatCard
          label="Locations covered"
          value={summary.locations}
          caption="Distinct sub-cities"
          icon={MapPin}
        />
      </StatGrid>

      <FilterBar clearHref={q ? '/civil' : undefined}>
        <SearchField
          id="q"
          name="q"
          label="Search registry"
          defaultValue={q ?? ''}
          placeholder="LHC number, sub-city, case number or applicant"
        />
      </FilterBar>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <Building2 className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            Civil property register
          </TableTitle>
          <Badge variant="default">
            {register.total} {q ? 'found' : 'properties'}
          </Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Case number</TH>
                <TH>LHC / title deed</TH>
                <TH>Location</TH>
                <TH>Holding right</TH>
                <TH className="text-right">Plot area (m²)</TH>
                <TH className="text-center">Buildings</TH>
                <TH>Category</TH>
                <TH className="text-right">Open</TH>
              </TR>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <EmptyRow
                  colSpan={8}
                  icon={Building2}
                  title={summary.properties === 0 ? 'Registry is empty' : 'No matching properties'}
                >
                  {summary.properties === 0
                    ? 'No civil properties have been registered in valuation cases yet.'
                    : 'No civil properties match your search criteria.'}
                </EmptyRow>
              ) : (
                rows.map((prop) => (
                  <TR key={prop.id}>
                    <TD>
                      <Link
                        href={`/requests/${prop.case.id}`}
                        className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                      >
                        {prop.case.caseNumber}
                      </Link>
                      <span className="block text-[11px] text-ink-3">
                        {prop.case.applicantName}
                      </span>
                    </TD>
                    <TD className="tabular text-[12px]">
                      {prop.lhcNumber || <span className="italic text-ink-3">Pending</span>}
                    </TD>
                    <TD className="text-[12px]">
                      <span className="block">
                        {prop.subCity
                          ? `${prop.subCity}, Woreda ${prop.woreda ?? '-'}`
                          : 'Unspecified'}
                      </span>
                      {prop.kebele || prop.houseNumber ? (
                        <span className="block text-[11px] text-ink-3">
                          Keb: {prop.kebele ?? '-'}, H.No: {prop.houseNumber ?? '-'}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <Badge variant={prop.landHoldingRight === 'LEASE' ? 'brand' : 'default'}>
                        {prop.landHoldingRight}
                      </Badge>
                    </TD>
                    <TDNum className="text-[12px]">
                      {prop.plotArea
                        ? formatAmount(prop.plotArea.toString()).replace(/.00$/, '')
                        : '—'}
                    </TDNum>
                    <TD className="text-center">
                      <Badge variant="accent">{prop._count.buildings}</Badge>
                    </TD>
                    <TD className="text-[12px] text-ink-2">{prop.category.name}</TD>
                    <TD className="text-right">
                      <Button asChild variant="ghost" size="icon-sm">
                        <Link
                          href={`/requests/${prop.case.id}`}
                          aria-label={`Open case ${prop.case.caseNumber}`}
                        >
                          <ExternalLink aria-hidden="true" />
                        </Link>
                      </Button>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={register.page}
        pageCount={register.pageCount}
        total={register.total}
        pageSize={register.pageSize}
        noun="properties"
        buildHref={(next) => pageHref('/civil', { q }, next)}
      />
    </div>
  );
}
