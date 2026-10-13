import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Calculator,
  ClipboardList,
  Cog,
  Landmark,
  MapPinned,
  MessagesSquare,
  Sigma,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { loadValuationWorkspace } from '@/server/application/valuation-service';
import { loadReview } from '@/server/application/review-service';
import { ReviewPanel } from '@/components/valuation/review-panel';
import { AccessDenied } from '@/components/admin/access-denied';
import { StatusBadge } from '@/components/workflow/status-badge';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';
import {
  BuildingList,
  CivilPropertyForm,
  type BuildingRow,
} from '@/components/valuation/civil-property';
import { MechanicalItems, MechanicalSiteForm } from '@/components/valuation/mechanical-property';
import { CivilWorksheetForm } from '@/components/valuation/civil-worksheet';
import {
  MechanicalWorksheetForm,
  type MechanicalItemRow,
} from '@/components/valuation/mechanical-worksheet';
import { ValuationBreakdown } from '@/components/valuation/valuation-breakdown';
import { SiteVisits } from '@/components/valuation/site-visits';
import { etb } from '@/components/valuation/labels';
import { NotFoundError } from '@/lib/errors';
import type { CaseStatus } from '@/server/domain/shared/enums';
import type { MechanicalWorksheet } from '@/lib/validation/valuation';
import type { LucideIcon } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Decimal and Date values cannot cross into a client component; strings can. */
const s = (value: { toString(): string } | null | undefined) =>
  value === null || value === undefined ? null : value.toString();

function Step({
  id,
  number,
  icon,
  title,
  description,
  children,
}: {
  id: string;
  number: number;
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-4 overflow-hidden">
      <CardBar>
        <div className="flex min-w-0 items-center gap-3">
          <CardIcon icon={icon} />
          <div className="min-w-0">
            <CardTitle>
              <span className="mr-1.5 text-ink-3">{number}.</span>
              {title}
            </CardTitle>
            <p className="text-[12.5px] text-ink-3">{description}</p>
          </div>
        </div>
      </CardBar>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

export default async function ValuationWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;

  const workspace = await loadValuationWorkspace(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  if (!workspace.canRead) {
    return <AccessDenied permission="valuation:read" what="this case's valuation" />;
  }

  const {
    subject,
    discipline,
    guide,
    summary,
    civil,
    mechanical,
    run,
    categories,
    siteVisits,
    canEditProperty,
    canCalculate,
    canRecordVisit,
    maxAccuracyMeters,
    verified,
  } = workspace;
  const review = await loadReview(actor, subject.id);
  const today = new Date().toISOString().slice(0, 10);
  const located = civil ?? mechanical;
  const propertyLocation =
    located?.latitude && located.longitude
      ? { latitude: located.latitude.toString(), longitude: located.longitude.toString() }
      : null;
  const categoryOptions = categories.map((c) => ({
    code: c.code,
    name: c.parent ? `${c.parent.name} - ${c.name}` : c.name,
  }));

  const buildings: BuildingRow[] = (civil?.buildings ?? []).map((b) => ({
    id: b.id,
    buildingNumber: b.buildingNumber,
    buildingType: b.buildingType,
    categoryCode: b.category?.code ?? null,
    floorCount: b.floorCount,
    grossArea: s(b.grossArea),
    builtUpArea: s(b.builtUpArea),
    constructionStatus: b.constructionStatus,
    constructionYear: b.constructionYear,
    condition: b.condition,
    progressPercent: s(b.progressPercent),
    remarks: b.remarks,
  }));

  const vehicles = (mechanical?.vehicles ?? []).map((v) => ({
    id: v.id,
    itemNumber: v.itemNumber,
    categoryCode: v.category?.code ?? null,
    ownerName: v.ownerName,
    plateNumber: v.plateNumber,
    chassisNumber: v.chassisNumber,
    engineNumber: v.engineNumber,
    make: v.make,
    model: v.model,
    manufactureYear: v.manufactureYear,
    capacity: v.capacity,
    horsePower: s(v.horsePower),
    cylinderCount: v.cylinderCount,
    axleNumber: v.axleNumber,
    colour: v.colour,
    libreReference: v.libreReference,
    condition: v.condition,
    mileage: s(v.mileage),
    remarks: v.remarks,
  }));

  const machinery = (mechanical?.machinery ?? []).map((mc) => ({
    id: mc.id,
    itemNumber: mc.itemNumber,
    categoryCode: mc.category?.code ?? null,
    ownerName: mc.ownerName,
    equipmentName: mc.equipmentName,
    manufacturer: mc.manufacturer,
    model: mc.model,
    serialNumber: mc.serialNumber,
    manufactureYear: mc.manufactureYear,
    capacity: mc.capacity,
    countryOfOrigin: mc.countryOfOrigin,
    installationLocation: mc.installationLocation,
    condition: mc.condition,
    purchasePrice: s(mc.purchasePrice),
    insuranceValue: s(mc.insuranceValue),
    cifValue: s(mc.cifValue),
    remainingLifeYears: s(mc.remainingLifeYears),
    remarks: mc.remarks,
  }));

  const mechanicalItems: MechanicalItemRow[] = [
    ...vehicles.map((v) => ({
      id: v.id,
      kind: 'VEHICLE' as const,
      itemNumber: v.itemNumber,
      description:
        [v.make, v.model, v.plateNumber ? `(${v.plateNumber})` : null].filter(Boolean).join(' ') ||
        'Vehicle',
      manufactureYear: v.manufactureYear,
      cifValue: null,
    })),
    ...machinery.map((mc) => ({
      id: mc.id,
      kind: 'MACHINERY' as const,
      itemNumber: mc.itemNumber,
      description: mc.equipmentName,
      manufactureYear: mc.manufactureYear,
      cifValue: mc.cifValue,
    })),
  ].sort((a, b) => a.itemNumber - b.itemNumber);

  const worksheet = run?.engine === discipline ? run.worksheet : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Link
            href={`/requests/${subject.id}`}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to the case
          </Link>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-nib-gold-600 dark:text-nib-gold-400">
            Valuation workspace · {subject.requestType.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[26px]">
              {subject.caseNumber}
            </h1>
            <StatusBadge status={subject.status as CaseStatus} />
            <Badge variant="brand">{discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}</Badge>
          </div>
          <p className="mt-1 text-[13px] text-ink-3">
            {subject.ownerName} · valuator {subject.maker?.fullName ?? 'not yet assigned'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-44 rounded-(--radius-card) bg-surface px-4 py-3 shadow-card">
            <p className="text-[11.5px] font-medium text-ink-3">Market value</p>
            <p className="text-[18px] font-bold text-nib-gold-800 dark:text-nib-gold-400">
              {summary?.marketValue ? `ETB ${etb(summary.marketValue)}` : 'Not calculated'}
            </p>
          </div>
          <div className="min-w-44 rounded-(--radius-card) bg-surface px-4 py-3 shadow-card">
            <p className="text-[11.5px] font-medium text-ink-3">Forced-sale value</p>
            <p className="text-[18px] font-bold text-ink">
              {summary?.forcedSaleValue ? `ETB ${etb(summary.forcedSaleValue)}` : '—'}
            </p>
          </div>
        </div>
      </header>

      <nav aria-label="Workspace sections" className="flex flex-wrap gap-2">
        {[
          ['#property', '1. Property'],
          ['#inputs', '2. Valuation inputs'],
          ['#result', '3. Result'],
          ['#visits', '4. Site visits'],
          ['#review', review && review.open > 0 ? `5. Review (${review.open} open)` : '5. Review'],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="rounded-full bg-surface px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 shadow-card transition-colors hover:bg-nib-gold-500/15 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>

      {!canEditProperty && !canCalculate ? (
        <Alert variant="info">
          <ClipboardList aria-hidden="true" />
          <AlertTitle>Read only</AlertTitle>
          <AlertDescription>
            {subject.maker
              ? `The valuation is prepared by ${subject.maker.fullName}, the valuator assigned to this case, while it is in progress.`
              : 'A valuator must be assigned before the valuation can be prepared.'}
          </AlertDescription>
        </Alert>
      ) : null}

      <Step
        id="property"
        number={1}
        icon={discipline === 'CIVIL' ? Landmark : Cog}
        title={discipline === 'CIVIL' ? 'Land and buildings' : 'Vehicles and machinery'}
        description={
          discipline === 'CIVIL'
            ? 'The property as registered. Areas and years here feed the calculation directly.'
            : 'The items as registered. Years and CIF values here feed the calculation directly.'
        }
      >
        {discipline === 'CIVIL' ? (
          <div className="space-y-8">
            <CivilPropertyForm
              caseId={subject.id}
              categories={categoryOptions}
              editable={canEditProperty}
              defaults={{
                categoryCode: civil?.category.code ?? null,
                landHoldingRight: civil?.landHoldingRight ?? 'FREEHOLD',
                plotArea: s(civil?.plotArea),
                lhcNumber: civil?.lhcNumber ?? null,
                subCity: civil?.subCity ?? null,
                woreda: civil?.woreda ?? null,
                kebele: civil?.kebele ?? null,
                houseNumber: civil?.houseNumber ?? null,
                geographicLocation: civil?.geographicLocation ?? null,
                latitude: s(civil?.latitude),
                longitude: s(civil?.longitude),
                leaseRemainingYears: civil?.leaseRemainingYears ?? null,
                leaseUnpaidBalance: s(civil?.leaseUnpaidBalance),
                leaseAnnualRate: s(civil?.leaseAnnualRate),
                boundaryDescription: civil?.boundaryDescription ?? null,
                remarks: civil?.remarks ?? null,
              }}
            />
            <BuildingList
              caseId={subject.id}
              buildings={buildings}
              categories={categoryOptions}
              editable={canEditProperty}
              hasProperty={civil !== null}
            />
          </div>
        ) : (
          <div className="space-y-8">
            <MechanicalSiteForm
              caseId={subject.id}
              editable={canEditProperty}
              defaults={{
                plantName: mechanical?.plantName ?? null,
                installationAddress: mechanical?.installationAddress ?? null,
                operationalStatus: mechanical?.operationalStatus ?? null,
                remarks: mechanical?.remarks ?? null,
              }}
            />
            <MechanicalItems
              caseId={subject.id}
              vehicles={vehicles}
              machinery={machinery}
              categories={categoryOptions}
              editable={canEditProperty}
            />
          </div>
        )}
      </Step>

      <Step
        id="inputs"
        number={2}
        icon={Calculator}
        title="Valuation inputs"
        description={
          canCalculate
            ? discipline === 'CIVIL'
              ? 'Location, building components and site works, priced from the valuation guideline. Calculating saves them with the result.'
              : 'Rates, comparables and adjustments. Calculating saves them with the result.'
            : 'The inputs of the last calculation.'
        }
      >
        {discipline === 'CIVIL' ? (
          civil ? (
            <CivilWorksheetForm
              caseId={subject.id}
              guide={guide}
              land={{
                holdingRight: civil.landHoldingRight,
                plotArea: s(civil.plotArea),
                leaseRemainingYears: civil.leaseRemainingYears,
                leaseUnpaidBalance: s(civil.leaseUnpaidBalance),
                latitude: s(civil.latitude),
                longitude: s(civil.longitude),
              }}
              buildings={buildings}
              initial={worksheet}
              today={today}
              canCalculate={canCalculate}
            />
          ) : (
            <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
              Record the land and property details in step 1 first.
            </p>
          )
        ) : (
          <MechanicalWorksheetForm
            caseId={subject.id}
            guide={guide}
            items={mechanicalItems}
            initial={worksheet as MechanicalWorksheet | null}
            today={today}
            canCalculate={canCalculate}
          />
        )}
        {!canCalculate && canEditProperty ? (
          <p className="mt-4 text-[12px] text-ink-3">
            Start the valuation from the case page to calculate; the case must be On Progress.
          </p>
        ) : null}
      </Step>

      <Step
        id="result"
        number={3}
        icon={Sigma}
        title="Result"
        description="The full working of the last calculation, exactly as stored."
      >
        {run ? (
          <ValuationBreakdown
            run={{
              engine: run.engine,
              output: run.output,
              performedAt: run.performedAt,
              performedBy: run.performedBy,
              formulaVersion: run.formulaVersion,
              parameterSet: run.parameterSet,
              inputHash: run.inputHash,
              current: run.current,
            }}
            stale={summary?.stale ?? false}
            verified={verified}
          />
        ) : (
          <div className="flex flex-col items-center rounded-(--radius-control) bg-surface-2 px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-nib-gold-500/15 text-nib-gold-700 dark:text-nib-gold-400">
              {discipline === 'CIVIL' ? (
                <Building2 className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Cog className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <p className="mt-3 text-[13.5px] font-semibold text-ink">Not calculated yet</p>
            <p className="mt-1 max-w-md text-[12.5px] text-ink-3">
              The market and forced-sale values appear here, with every step of the working, once
              the valuation is calculated.
            </p>
          </div>
        )}
      </Step>

      <Step
        id="visits"
        number={4}
        icon={MapPinned}
        title="Site visits"
        description="Inspections of the property, including attempts where access was refused."
      >
        <SiteVisits
          caseId={subject.id}
          canRecord={canRecordVisit}
          maxAccuracyMeters={maxAccuracyMeters}
          property={propertyLocation}
          visits={siteVisits.map((v) => ({
            id: v.id,
            visitedAt: v.visitedAt.toISOString(),
            visitedBy: v.visitedBy.fullName,
            accessGained: v.accessGained,
            findings: v.findings,
            remarks: v.remarks,
            check: v.locationCheck,
            latitude: s(v.latitude),
            longitude: s(v.longitude),
            accuracyMeters: s(v.accuracyMeters),
            distanceMeters: s(v.distanceMeters),
            // Photos are added by the valuator who made the visit, while it is theirs to record.
            canAddPhotos: canRecordVisit && v.visitedById === actor.id,
            photos: v.photos.map((p) => ({
              id: p.id,
              takenAt: p.uploadedAt.toISOString(),
              viewable: p.scanStatus === 'CLEAN',
              check: p.locationCheck,
              latitude: s(p.latitude),
              longitude: s(p.longitude),
              accuracyMeters: s(p.accuracyMeters),
              distanceMeters: s(p.distanceMeters),
            })),
          }))}
        />
      </Step>

      {review ? (
        <Step
          id="review"
          number={5}
          icon={MessagesSquare}
          title="Review"
          description="The checker's comments, answered in threads. Checking completes when every one is resolved."
        >
          <ReviewPanel
            caseId={subject.id}
            discipline={discipline}
            canRaise={review.canRaise}
            canReply={review.canReply}
            canResolve={review.canResolve}
            threads={review.threads.map((t) => ({
              id: t.id,
              body: t.body,
              author: t.author,
              authorIsChecker: t.authorIsChecker,
              createdAt: t.createdAt.toISOString(),
              section: t.section,
              isResolved: t.isResolved,
              replies: t.replies.map((r) => ({
                id: r.id,
                body: r.body,
                author: r.author,
                authorIsChecker: r.authorIsChecker,
                createdAt: r.createdAt.toISOString(),
              })),
            }))}
          />
        </Step>
      ) : null}
    </div>
  );
}
