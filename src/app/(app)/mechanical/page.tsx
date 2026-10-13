import Link from 'next/link';
import { Car, Cog, ExternalLink, Factory, ShieldAlert, Wrench } from 'lucide-react';
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
import { listMechanicalRegister } from '@/server/application/property-register-service';
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
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/** Tabs are links, so the active one is styled here rather than by a variant. */
function Tab({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: typeof Car;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-10 items-center gap-2 rounded-(--radius-control) px-4 text-[13px] font-semibold',
        'transition-[background-color,color,box-shadow] duration-150',
        active
          ? 'bg-nib-gold-500 text-nib-brown-900 shadow-card'
          : 'border border-line bg-surface text-ink-2 hover:border-nib-gold-500/40 hover:text-ink',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </Link>
  );
}

export default async function MechanicalPropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string }>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.VALUATION_READ)) {
    return <AccessDenied permission="valuation:read" what="mechanical property records" />;
  }

  const { tab: rawTab, q, page } = await searchParams;
  // Anything that is not the machinery tab is the vehicles tab, so an edited
  // query string cannot land the page on a view with no heading.
  const tab = rawTab === 'machinery' ? 'machinery' : 'vehicles';
  const register = await listMechanicalRegister(actor, {
    tab,
    search: q,
    page: readPage(page),
    pageSize: LIST_PAGE_SIZE,
  });
  const { vehicles, machinery, summary } = register;

  // The tab links must survive a search term containing an ampersand or a
  // space, so the query is assembled rather than interpolated.
  const tabHref = (next: 'vehicles' | 'machinery') => {
    const params = new URLSearchParams({ tab: next });
    if (q) params.set('q', q);
    return `/mechanical?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Valuation"
        title="Mechanical Properties Registry"
        subtitle="Directory of moveable collateral — automotive vehicles, industrial plant and machinery recorded in mechanical valuations."
        actions={
          <Button asChild variant="outline">
            <Link href="/requests/new">
              <Cog aria-hidden="true" />
              New valuation request
            </Link>
          </Button>
        }
      />

      <StatGrid>
        <StatCard
          label="Mechanical cases"
          value={summary.packages}
          caption="Collateral packages"
          icon={Factory}
          tone="brand"
        />
        <StatCard
          label="Vehicles"
          value={summary.vehicles}
          caption="Automobiles & commercial trucks"
          icon={Car}
        />
        <StatCard
          label="Machinery"
          value={summary.machinery}
          caption="Industrial units & equipment"
          icon={Wrench}
        />
        <StatCard
          label="Rated good or above"
          value={summary.goodCondition}
          caption="Vehicles and machinery together"
          icon={ShieldAlert}
          tone={summary.goodCondition > 0 ? 'good' : 'default'}
        />
      </StatGrid>

      <div className="flex flex-wrap items-center gap-2">
        <Tab href={tabHref('vehicles')} active={tab === 'vehicles'} icon={Car}>
          Vehicles ({summary.vehicles})
        </Tab>
        <Tab href={tabHref('machinery')} active={tab === 'machinery'} icon={Wrench}>
          Machinery &amp; equipment ({summary.machinery})
        </Tab>
      </div>

      <FilterBar clearHref={q ? tabHref(tab) : undefined}>
        <input type="hidden" name="tab" value={tab} />
        <SearchField
          id="q"
          name="q"
          label="Search registry"
          defaultValue={q ?? ''}
          placeholder={
            tab === 'vehicles'
              ? 'Plate, chassis, make or case number'
              : 'Equipment, serial, manufacturer or case number'
          }
        />
      </FilterBar>

      {tab === 'vehicles' ? (
        <TableWrap>
          <TableBar>
            <TableTitle>
              <Car className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Vehicle register
            </TableTitle>
            <Badge variant="default">
              {register.total} {q ? 'found' : 'vehicles'}
            </Badge>
          </TableBar>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Case number</TH>
                  <TH>Plate number</TH>
                  <TH>Chassis / VIN</TH>
                  <TH>Make &amp; model</TH>
                  <TH className="text-center">Year</TH>
                  <TH>Condition</TH>
                  <TH className="text-right">Mileage</TH>
                  <TH className="text-right">Open</TH>
                </TR>
              </THead>
              <TBody>
                {vehicles.length === 0 ? (
                  <EmptyRow
                    colSpan={8}
                    icon={Car}
                    title={summary.vehicles === 0 ? 'No vehicles yet' : 'No matching vehicles'}
                  >
                    {summary.vehicles === 0
                      ? 'No vehicles have been registered in valuation cases yet.'
                      : 'No vehicles match your search criteria.'}
                  </EmptyRow>
                ) : (
                  vehicles.map((veh) => (
                    <TR key={veh.id}>
                      <TD>
                        <Link
                          href={`/requests/${veh.property.case.id}`}
                          className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                        >
                          {veh.property.case.caseNumber}
                        </Link>
                        <span className="block text-[11px] text-ink-3">
                          {veh.property.case.applicantName}
                        </span>
                      </TD>
                      <TD className="tabular text-[12px] font-semibold">
                        {veh.plateNumber ?? <span className="italic text-ink-3">Unregistered</span>}
                      </TD>
                      <TD className="tabular text-[12px] text-ink-2">{veh.chassisNumber ?? '—'}</TD>
                      <TD className="text-[12px]">
                        <span className="block font-medium text-ink">
                          {veh.make ?? 'Unknown'} {veh.model ?? ''}
                        </span>
                        <span className="block text-[11px] text-ink-3">
                          {veh.category?.name ?? 'Vehicle'}
                        </span>
                      </TD>
                      <TD className="tabular text-center text-[12px]">
                        {veh.manufactureYear ?? '—'}
                      </TD>
                      <TD>
                        <Badge variant={veh.condition ? 'brand' : 'inactive'}>
                          {veh.condition ?? 'PENDING'}
                        </Badge>
                      </TD>
                      <TDNum className="text-[12px]">
                        {veh.mileage ? `${Number(veh.mileage).toLocaleString()} km` : '—'}
                      </TDNum>
                      <TD className="text-right">
                        <Button asChild variant="ghost" size="icon-sm">
                          <Link
                            href={`/requests/${veh.property.case.id}`}
                            aria-label={`Open case ${veh.property.case.caseNumber}`}
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
      ) : (
        <TableWrap>
          <TableBar>
            <TableTitle>
              <Wrench className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Machinery register
            </TableTitle>
            <Badge variant="default">
              {register.total} {q ? 'found' : 'items'}
            </Badge>
          </TableBar>
          <TableScroll>
            <Table>
              <THead>
                <TR>
                  <TH>Case number</TH>
                  <TH>Equipment name</TH>
                  <TH>Serial number</TH>
                  <TH>Manufacturer</TH>
                  <TH className="text-center">Year</TH>
                  <TH>Condition</TH>
                  <TH className="text-right">Purchase price (ETB)</TH>
                  <TH className="text-right">Open</TH>
                </TR>
              </THead>
              <TBody>
                {machinery.length === 0 ? (
                  <EmptyRow
                    colSpan={8}
                    icon={Wrench}
                    title={summary.machinery === 0 ? 'No machinery yet' : 'No matching machinery'}
                  >
                    {summary.machinery === 0
                      ? 'No machinery or industrial equipment has been registered yet.'
                      : 'No machinery items match your search criteria.'}
                  </EmptyRow>
                ) : (
                  machinery.map((mach) => (
                    <TR key={mach.id}>
                      <TD>
                        <Link
                          href={`/requests/${mach.property.case.id}`}
                          className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                        >
                          {mach.property.case.caseNumber}
                        </Link>
                        <span className="block text-[11px] text-ink-3">
                          {mach.property.case.applicantName}
                        </span>
                      </TD>
                      <TD className="text-[12px]">
                        <span className="block font-medium text-ink">{mach.equipmentName}</span>
                        <span className="block text-[11px] text-ink-3">
                          {mach.category?.name ?? 'Equipment'}
                        </span>
                      </TD>
                      <TD className="tabular text-[12px] text-ink-2">{mach.serialNumber ?? '—'}</TD>
                      <TD className="text-[12px]">
                        <span className="block">{mach.manufacturer ?? '—'}</span>
                        {mach.countryOfOrigin ? (
                          <span className="block text-[11px] text-ink-3">
                            Origin: {mach.countryOfOrigin}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="tabular text-center text-[12px]">
                        {mach.manufactureYear ?? '—'}
                      </TD>
                      <TD>
                        <Badge variant={mach.condition ? 'brand' : 'inactive'}>
                          {mach.condition ?? 'PENDING'}
                        </Badge>
                      </TD>
                      <TDNum className="text-[12px]">
                        {mach.purchasePrice ? formatAmount(mach.purchasePrice.toString()) : '—'}
                      </TDNum>
                      <TD className="text-right">
                        <Button asChild variant="ghost" size="icon-sm">
                          <Link
                            href={`/requests/${mach.property.case.id}`}
                            aria-label={`Open case ${mach.property.case.caseNumber}`}
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
      )}

      <Pagination
        page={register.page}
        pageCount={register.pageCount}
        total={register.total}
        pageSize={register.pageSize}
        noun={tab === 'vehicles' ? 'vehicles' : 'items'}
        buildHref={(next) => pageHref('/mechanical', { tab, q }, next)}
      />
    </div>
  );
}
