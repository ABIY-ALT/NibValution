'use client';

import { useActionState, useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, MapPin } from 'lucide-react';
import { calculateAction } from '@/server/actions/valuation-actions';
import type { WorkspaceActionState } from '@/server/actions/valuation-actions';
import type { ParameterGuide } from '@/server/application/valuation-service';
import type { LandHoldingRight } from '@/server/domain/shared/enums';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { BuildingPanel } from './civil-building-panel';
import { Disclosure, ItemOptions, Labelled, Section, WorkRows } from './civil-worksheet-bits';
import {
  blankBuilding,
  blankCivilWork,
  blankQuantity,
  describeIssue,
  initialState,
  isPoolItem,
  prescribedForcedSalePercent,
  toWorksheet,
  type BuildingState,
  type WorksheetState,
} from './civil-worksheet-state';
import { ActionMessage, INITIAL_STATE, SubmitButton } from './form-bits';
import { HOLDING_LABELS, etb, trimDecimal } from './labels';
import type { BuildingRow } from './civil-property';

type LocationKey = keyof WorksheetState['location'];

const RATINGS: {
  key: Exclude<LocationKey, 'city' | 'purpose' | 'propertyType' | 'floorLevel'>;
  label: string;
}[] = [
  { key: 'utility', label: 'Utility' },
  { key: 'neighbourhood', label: 'Neighbourhood standard' },
  { key: 'roadQuality', label: 'Road quality' },
  { key: 'roadWidth', label: 'Road width' },
  { key: 'proximity', label: 'Proximity to city centre' },
  { key: 'accessibility', label: 'Road accessibility' },
];

/**
 * The valuator's worksheet for a civil property, as the bank's valuation
 * guideline asks for it: where the property is and how its location rates,
 * what each building is made of, and the works on the plot. Every rate comes
 * from the guideline; nothing here is a price.
 */
export function CivilWorksheetForm({
  caseId,
  guide,
  land,
  buildings,
  initial,
  today,
  canCalculate,
}: {
  caseId: string;
  guide: ParameterGuide;
  land: {
    holdingRight: LandHoldingRight;
    plotArea: string | null;
    leaseRemainingYears: number | null;
    leaseUnpaidBalance: string | null;
    latitude: string | null;
    longitude: string | null;
  };
  buildings: BuildingRow[];
  /** The worksheet of the last calculation, whichever formula made it. */
  initial: unknown;
  today: string;
  canCalculate: boolean;
}) {
  const buildingIds = useMemo(() => buildings.map((b) => b.id), [buildings]);
  const [ws, setWs] = useState<WorksheetState>(() => initialState(initial, buildingIds, today));
  const [state, formAction] = useActionState<WorkspaceActionState, FormData>(
    calculateAction,
    INITIAL_STATE,
  );

  const set = <K extends keyof WorksheetState>(key: K, value: WorksheetState[K]) =>
    setWs((current) => ({ ...current, [key]: value }));
  const setLocation = (key: LocationKey, value: string) =>
    setWs((current) => ({ ...current, location: { ...current.location, [key]: value } }));
  const changeBuilding = useCallback(
    (buildingId: string, change: (current: BuildingState) => BuildingState) =>
      setWs((current) => ({
        ...current,
        buildings: {
          ...current.buildings,
          [buildingId]: change(current.buildings[buildingId] ?? blankBuilding()),
        },
      })),
    [],
  );

  const civil = guide.civil;
  if (!civil) {
    return (
      <Alert variant="warning">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>The valuation guideline tables are not installed</AlertTitle>
        <AlertDescription>
          The parameter set in force ({guide.setCode} v{guide.setVersion}) has no guideline tables,
          so a civil property cannot be valued. Ask an administrator to apply the guideline
          migration.
        </AlertDescription>
      </Alert>
    );
  }

  const leaseHeld = land.holdingRight !== 'FREEHOLD';
  const progressMode = buildings.some((b) => b.constructionStatus === 'UNDER_CONSTRUCTION');
  const asksFloorLevel = civil.floorLevelTypes.includes(ws.location.propertyType);
  const err = (path: string) => state.fieldErrors?.[`worksheet.${path}`]?.[0];

  const payload = JSON.stringify({
    discipline: 'CIVIL',
    caseId,
    worksheet: toWorksheet(ws, buildingIds, civil),
  });
  const buildingNumbers = buildings.map((b) => b.buildingNumber);
  const issues = Object.entries(state.fieldErrors ?? {}).flatMap(([path, messages]) =>
    messages.map((message) => describeIssue(path, message, buildingNumbers)),
  );

  const prescribedForcedSale = prescribedForcedSalePercent(
    civil,
    ws.location.city,
    ws.location.purpose,
  );
  const fixesOn = Object.entries(civil.fixes)
    .filter(([, on]) => on)
    .map(([name]) => name);
  const civilNames = [...civil.civilWorks.map((w) => w.name), ...civil.poolItems];

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="payload" value={payload} />
      <ItemOptions id="civil-works-items" names={civilNames} />
      <ItemOptions id="civil-supplementary-items" names={civil.supplementary.map((i) => i.name)} />
      <ItemOptions id="civil-gas-items" names={civil.gasStation.map((i) => i.name)} />
      <ItemOptions id="civil-coffee-items" names={civil.coffeeSite.map((i) => i.name)} />

      {state.ok ? (
        <ActionMessage state={state} />
      ) : state.message ? (
        <ActionMessage
          state={{ ...state, messages: issues.length > 0 ? issues : state.messages }}
        />
      ) : null}

      <fieldset disabled={!canCalculate} className="min-w-0 space-y-6 disabled:opacity-80">
        <Section title="Valuation date">
          <div className="grid gap-4 sm:grid-cols-3">
            <Labelled label="Date of valuation" htmlFor="ws-date">
              <Input
                id="ws-date"
                type="date"
                value={ws.valuationDate}
                max={today}
                aria-invalid={err('valuationDate') ? true : undefined}
                onChange={(e) => set('valuationDate', e.target.value)}
              />
            </Labelled>
            <p className="self-end text-[12px] leading-relaxed text-ink-3 sm:col-span-2">
              The guideline tables in force on this date are used: guideline {civil.version},
              parameter set {guide.setCode} v{guide.setVersion}
              {fixesOn.length > 0
                ? `, with ${fixesOn.length} workbook correction${fixesOn.length === 1 ? '' : 's'} switched on`
                : ', calculating exactly as the Excel template does'}
              .
            </p>
          </div>
        </Section>

        <Section title="Property and location">
          <div className="grid gap-4 sm:grid-cols-3">
            <Labelled label="City / town" htmlFor="ws-city">
              <Select
                id="ws-city"
                value={ws.location.city}
                aria-invalid={err('location.city') ? true : undefined}
                onChange={(e) => setLocation('city', e.target.value)}
              >
                <option value="">Choose…</option>
                {civil.cities.map((city) => (
                  <option key={city.name} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </Select>
            </Labelled>
            <Labelled label="Permitted land purpose" htmlFor="ws-purpose">
              <Select
                id="ws-purpose"
                value={ws.location.purpose}
                aria-invalid={err('location.purpose') ? true : undefined}
                onChange={(e) => setLocation('purpose', e.target.value)}
              >
                <option value="">Choose…</option>
                {civil.purposes.map((purpose) => (
                  <option key={purpose} value={purpose}>
                    {purpose}
                  </option>
                ))}
              </Select>
            </Labelled>
            <Labelled label="Property type" htmlFor="ws-property-type">
              <Select
                id="ws-property-type"
                value={ws.location.propertyType}
                aria-invalid={err('location.propertyType') ? true : undefined}
                onChange={(e) => setLocation('propertyType', e.target.value)}
              >
                <option value="">Choose…</option>
                {civil.propertyTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </Labelled>
            {asksFloorLevel ? (
              <Labelled
                label="Floor level of the unit"
                htmlFor="ws-floor"
                hint="0 for the ground floor."
              >
                <Input
                  id="ws-floor"
                  inputMode="numeric"
                  value={ws.location.floorLevel}
                  aria-invalid={err('location.floorLevel') ? true : undefined}
                  onChange={(e) => setLocation('floorLevel', e.target.value)}
                />
              </Labelled>
            ) : null}
          </div>

          <p className="flex items-start gap-2 rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-ink-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
            {land.latitude && land.longitude ? (
              <span>
                Coordinates {trimDecimal(land.latitude)}, {trimDecimal(land.longitude)} are on
                record. If they fall in one of the guideline&apos;s location zones for this city,
                that zone&apos;s rate prices the land; otherwise the city&apos;s base rate does.
              </span>
            ) : (
              <span>
                No coordinates are recorded for this property, so the land is priced at the
                city&apos;s base rate. Record them in step 1, or check in on site, to price it by
                location zone.
              </span>
            )}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {RATINGS.map(({ key, label }) => (
              <Labelled key={key} label={label} htmlFor={`ws-${key}`}>
                <Select
                  id={`ws-${key}`}
                  value={ws.location[key]}
                  aria-invalid={err(`location.${key}`) ? true : undefined}
                  onChange={(e) => setLocation(key, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {civil.ratings[key].map((choice) => (
                    <option key={choice} value={choice}>
                      {choice}
                    </option>
                  ))}
                </Select>
              </Labelled>
            ))}
          </div>
        </Section>

        <Section
          title="Land"
          aside={`${HOLDING_LABELS[land.holdingRight]} · ${trimDecimal(land.plotArea)} m²`}
        >
          {leaseHeld ? (
            <>
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                {land.leaseRemainingYears ?? '—'} lease years remain
                {land.leaseUnpaidBalance
                  ? ` (ETB ${etb(land.leaseUnpaidBalance)} unpaid on record)`
                  : ''}
                . With {civil.lease.fullValueFromRemainingYears} or more remaining the leased land
                is valued in full; with fewer it is valued on the lease terms below.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Labelled label="Total lease period (years)" htmlFor="ws-lease-years">
                  <Input
                    id="ws-lease-years"
                    inputMode="numeric"
                    value={ws.lease.totalYears}
                    placeholder="e.g. 60"
                    aria-invalid={err('lease.totalYears') ? true : undefined}
                    onChange={(e) => set('lease', { ...ws.lease, totalYears: e.target.value })}
                  />
                </Labelled>
                <Labelled label="Total lease amount (ETB)" htmlFor="ws-lease-total">
                  <Input
                    id="ws-lease-total"
                    inputMode="decimal"
                    value={ws.lease.totalAmount}
                    aria-invalid={err('lease.totalAmount') ? true : undefined}
                    onChange={(e) => set('lease', { ...ws.lease, totalAmount: e.target.value })}
                  />
                </Labelled>
                <Labelled label="Paid-up lease amount (ETB)" htmlFor="ws-lease-paid">
                  <Input
                    id="ws-lease-paid"
                    inputMode="decimal"
                    value={ws.lease.paidAmount}
                    aria-invalid={err('lease.paidAmount') ? true : undefined}
                    onChange={(e) => set('lease', { ...ws.lease, paidAmount: e.target.value })}
                  />
                </Labelled>
                {land.holdingRight === 'BOTH' ? (
                  <Labelled label="Free-hold part of the plot (m²)" htmlFor="ws-freehold">
                    <Input
                      id="ws-freehold"
                      inputMode="decimal"
                      value={ws.lease.freeholdArea}
                      aria-invalid={err('lease.freeholdArea') ? true : undefined}
                      onChange={(e) => set('lease', { ...ws.lease, freeholdArea: e.target.value })}
                    />
                  </Labelled>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] leading-relaxed text-ink-3">
              Free-hold land is valued at the location rate over the whole plot. The rate comes from
              the guideline: the zone or city rate, reduced for plot size and by the location
              ratings above.
            </p>
          )}
        </Section>

        <Section
          title="Buildings"
          aside={
            progressMode
              ? 'A building is under construction: the property is valued as it stands'
              : 'Depreciated replacement cost from the guideline cost curves'
          }
        >
          {buildings.length === 0 ? (
            <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
              No buildings are registered, so the property is valued on its land and site works.
            </p>
          ) : (
            <div className="space-y-4">
              {buildings.map((building) => (
                <BuildingPanel
                  key={building.id}
                  building={building}
                  state={ws.buildings[building.id] ?? blankBuilding()}
                  guide={civil}
                  onChange={changeBuilding}
                />
              ))}
            </div>
          )}
        </Section>

        <Section title="Site works" aside="Priced at the guideline's rates">
          <div className="space-y-3">
            <Disclosure
              title="Internal and plot civil works"
              defaultOpen
              badge={
                ws.civil.length > 0 ? `${ws.civil.length} added` : 'fences, tanks, compound, pool'
              }
            >
              <WorkRows
                idPrefix="cw"
                listId="civil-works-items"
                items={civil.civilWorks}
                rows={ws.civil}
                blank={blankCivilWork}
                onChange={(rows) => set('civil', rows)}
                addLabel="Add plot civil work"
                showCompletion={progressMode}
                hideQuantity={(row) =>
                  isPoolItem(civil, row.item) ||
                  (civil.civilWorks.find((w) => w.name === row.item)?.lumpSum ?? false)
                }
                hint={(row) => {
                  if (isPoolItem(civil, row.item)) {
                    return 'Priced from the pool’s bill of quantities for the size entered.';
                  }
                  const picked = civil.civilWorks.find((w) => w.name === row.item);
                  return picked?.lumpSum ? `Lump sum, ETB ${etb(String(picked.rate))}` : null;
                }}
                renderExtra={(row, update, id) => (
                  <div className="flex flex-wrap items-end gap-3">
                    {isPoolItem(civil, row.item) ? (
                      <>
                        <Labelled label="Length (m)" htmlFor={`${id}-l`} className="w-28">
                          <Input
                            id={`${id}-l`}
                            inputMode="decimal"
                            value={row.length}
                            onChange={(e) => update({ length: e.target.value })}
                          />
                        </Labelled>
                        <Labelled label="Width (m)" htmlFor={`${id}-w`} className="w-28">
                          <Input
                            id={`${id}-w`}
                            inputMode="decimal"
                            value={row.width}
                            onChange={(e) => update({ width: e.target.value })}
                          />
                        </Labelled>
                        <Labelled label="Depth (m)" htmlFor={`${id}-d`} className="w-28">
                          <Input
                            id={`${id}-d`}
                            inputMode="decimal"
                            value={row.depth}
                            onChange={(e) => update({ depth: e.target.value })}
                          />
                        </Labelled>
                      </>
                    ) : null}
                    <Labelled label="Note" htmlFor={`${id}-note`} className="min-w-[12rem] flex-1">
                      <Input
                        id={`${id}-note`}
                        value={row.description}
                        placeholder="e.g. how the quantity was measured"
                        onChange={(e) => update({ description: e.target.value })}
                      />
                    </Labelled>
                  </div>
                )}
              />
            </Disclosure>
            <Disclosure
              title="Fuel station works"
              defaultOpen={ws.gasStation.length > 0}
              badge={ws.gasStation.length > 0 ? `${ws.gasStation.length} added` : null}
            >
              <WorkRows
                idPrefix="gs"
                listId="civil-gas-items"
                items={civil.gasStation}
                rows={ws.gasStation}
                blank={blankQuantity}
                onChange={(rows) => set('gasStation', rows)}
                addLabel="Add fuel station item"
                showCompletion={progressMode}
              />
            </Disclosure>
            <Disclosure
              title="Coffee washing site works"
              defaultOpen={ws.coffeeSite.length > 0}
              badge={ws.coffeeSite.length > 0 ? `${ws.coffeeSite.length} added` : null}
            >
              <WorkRows
                idPrefix="cs"
                listId="civil-coffee-items"
                items={civil.coffeeSite}
                rows={ws.coffeeSite}
                blank={blankQuantity}
                onChange={(rows) => set('coffeeSite', rows)}
                addLabel="Add coffee site item"
                showCompletion={progressMode}
              />
            </Disclosure>
          </div>
        </Section>

        <Section title="Reconciliation and forced sale">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                The sale approach applies to a residential building, condominium or apartment on
                residential land in Addis Ababa, and the guideline then sets the weights. Anywhere
                else the market value is the cost approach alone.
              </p>
              <label className="flex items-center gap-2.5 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-nib-gold-600"
                  checked={ws.reconciliation.override}
                  onChange={(e) =>
                    set('reconciliation', { ...ws.reconciliation, override: e.target.checked })
                  }
                />
                Use different weights where a sale value applies
              </label>
              {ws.reconciliation.override ? (
                <div className="grid grid-cols-2 gap-3">
                  <Labelled label="Cost weight (%)" htmlFor="ws-cw">
                    <Input
                      id="ws-cw"
                      inputMode="decimal"
                      value={ws.reconciliation.costWeight}
                      onChange={(e) =>
                        set('reconciliation', { ...ws.reconciliation, costWeight: e.target.value })
                      }
                    />
                  </Labelled>
                  <Labelled label="Sale weight (%)" htmlFor="ws-sw">
                    <Input
                      id="ws-sw"
                      inputMode="decimal"
                      value={ws.reconciliation.salesWeight}
                      aria-invalid={err('reconciliation.salesWeight') ? true : undefined}
                      onChange={(e) =>
                        set('reconciliation', {
                          ...ws.reconciliation,
                          salesWeight: e.target.value,
                        })
                      }
                    />
                  </Labelled>
                  <Labelled label="Why" htmlFor="ws-cw-why" className="col-span-2">
                    <Textarea
                      id="ws-cw-why"
                      rows={2}
                      value={ws.reconciliation.rationale}
                      aria-invalid={err('reconciliation.rationale') ? true : undefined}
                      onChange={(e) =>
                        set('reconciliation', { ...ws.reconciliation, rationale: e.target.value })
                      }
                    />
                  </Labelled>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                Guideline forced-sale value
                {ws.location.city && ws.location.purpose
                  ? ` for ${ws.location.purpose.toLowerCase()} property in ${ws.location.city}`
                  : ''}
                : {prescribedForcedSale}% of market value.
              </p>
              <label className="flex items-center gap-2.5 text-[13px] text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-nib-gold-600"
                  checked={ws.forcedSale.override}
                  onChange={(e) =>
                    set('forcedSale', { ...ws.forcedSale, override: e.target.checked })
                  }
                />
                Use a different percentage for this case
              </label>
              {ws.forcedSale.override ? (
                <div className="grid grid-cols-2 gap-3">
                  <Labelled label="Forced-sale %" htmlFor="ws-fs">
                    <Input
                      id="ws-fs"
                      inputMode="decimal"
                      value={ws.forcedSale.percent}
                      aria-invalid={err('forcedSale.percent') ? true : undefined}
                      onChange={(e) =>
                        set('forcedSale', { ...ws.forcedSale, percent: e.target.value })
                      }
                    />
                  </Labelled>
                  <Labelled label="Why" htmlFor="ws-fs-why" className="col-span-2">
                    <Textarea
                      id="ws-fs-why"
                      rows={2}
                      value={ws.forcedSale.reason}
                      aria-invalid={err('forcedSale.reason') ? true : undefined}
                      onChange={(e) =>
                        set('forcedSale', { ...ws.forcedSale, reason: e.target.value })
                      }
                    />
                  </Labelled>
                </div>
              ) : null}
            </div>
          </div>
        </Section>

        <Section title="Valuator's remarks">
          <Textarea
            aria-label="Valuator's remarks"
            rows={4}
            value={ws.remarks}
            onChange={(e) => set('remarks', e.target.value)}
          />
          {civil.remarks.length > 0 ? (
            <Disclosure
              title="Standard remarks from the guideline"
              badge={`${civil.remarks.length}`}
            >
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {civil.remarks.map((entry, index) => (
                  <li
                    key={index}
                    className="flex items-start justify-between gap-3 border-b border-line/60 pb-2 last:border-0"
                  >
                    <span className="min-w-0 text-[12.5px] text-ink">
                      {entry.remark}
                      <span className="mt-0.5 block text-[11px] text-ink-3">
                        {entry.case ?? entry.section}
                        {entry.impact ? ` — ${entry.impact}` : ''}
                      </span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        set(
                          'remarks',
                          ws.remarks.trim()
                            ? `${ws.remarks.trim()}\n${entry.remark}`
                            : entry.remark,
                        )
                      }
                    >
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </Section>
      </fieldset>

      {canCalculate ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="max-w-xl text-[12px] leading-relaxed text-ink-3">
            The figures are computed on the server from these inputs, the property as registered and
            the guideline tables, and every calculation is kept so it can be reproduced.
          </p>
          <SubmitButton pendingLabel="Calculating…">
            <Calculator aria-hidden="true" />
            Calculate valuation
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
