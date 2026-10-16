import type {
  CivilBuildingOutput,
  CivilEngineOutput,
  PricedItemOutput,
} from '@/server/domain/valuation/civil/types';
import {
  isLegacyCivilOutput,
  type LegacyCivilEngineOutput,
} from '@/server/domain/valuation/civil-legacy';
import type { MechanicalEngineOutput } from '@/server/domain/valuation/mechanical-legacy';
import { isEnteredOutput } from '@/server/domain/valuation/calculation';
import { dec } from '@/lib/money';
import { cn } from '@/lib/utils';
import { CONSTRUCTION_LABELS, METHOD_LABELS, etb, humaniseKey, trimDecimal } from './labels';

/**
 * The working of a valuation, as a signed report shows it, rendered from the
 * stored run's output - never the live case, so it always shows exactly what
 * was signed.
 *
 * A run is either the valuator's entry - two figures, with no working - or, for
 * a case valued before the calculation engines were retired, the full working
 * of the engine (spec section 9: input, formula, rate, quantity, amount,
 * adjustment, depreciation, final value). Reports signed from such a run go on
 * rendering that working exactly as issued.
 */

function Formula({ children }: { children: React.ReactNode }) {
  return <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-3">{children}</span>;
}

const TH = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3';
const TD = 'px-3 py-2.5 align-top';
const NUM = 'tabular whitespace-nowrap px-3 py-2.5 text-right align-top';

function Table({ children, minWidth = '44rem' }: { children: React.ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto rounded-(--radius-control) border border-line">
      <table className="w-full text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

function TotalRow({
  label,
  value,
  strong = false,
  colSpan,
}: {
  label: React.ReactNode;
  value: string;
  strong?: boolean;
  colSpan: number;
}) {
  return (
    <tr className={cn(strong ? 'bg-nib-gold-500/10' : 'bg-surface-2/60')}>
      <td colSpan={colSpan} className={cn(TD, strong ? 'font-semibold text-ink' : 'text-ink-2')}>
        {label}
      </td>
      <td className={cn(NUM, strong ? 'font-bold text-ink' : 'font-semibold text-ink')}>
        {etb(value)}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Civil
// ---------------------------------------------------------------------------

/** A step of the land working: what it is, how it was reached, and the figure. */
function Step({
  label,
  formula,
  value,
  unit,
  strong = false,
}: {
  label: string;
  formula?: React.ReactNode;
  value: string;
  unit?: string;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? 'bg-nib-gold-500/10' : undefined}>
      <td className={TD}>
        <span className={cn('font-medium text-ink', strong && 'font-semibold')}>{label}</span>
        {formula ? <Formula>{formula}</Formula> : null}
      </td>
      <td className={cn(NUM, strong ? 'font-bold text-ink' : 'font-semibold')}>
        {value}
        {unit ? <span className="ml-1 text-[11.5px] font-normal text-ink-3">{unit}</span> : null}
      </td>
    </tr>
  );
}

function LandWorking({ output }: { output: CivilEngineOutput }) {
  const land = output.land;
  return (
    <section className="space-y-3">
      <h3 className="text-[14px] font-semibold text-ink">Location value</h3>
      <Table minWidth="36rem">
        <tbody className="divide-y divide-line">
          <Step
            label="Maximum location rate"
            formula={land.maxRate.formula}
            value={etb(land.maxRate.value)}
            unit="per m²"
          />
          <Step
            label={`Rate after plot-size tiers (${trimDecimal(land.plotArea)} m²)`}
            formula={land.tiers.formula}
            value={etb(land.tiers.averageRate)}
            unit="per m²"
          />
          <tr>
            <td className={TD} colSpan={2}>
              <span className="font-medium text-ink">Location factors</span>
              <dl className="mt-1.5 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                {land.factors.map((factor) => (
                  <div key={factor.key} className="flex items-baseline justify-between gap-3">
                    <dt className="min-w-0 text-ink-2">
                      {factor.label}: <span className="text-ink">{factor.choice}</span>
                      <span className="block text-[11px] text-ink-3">{factor.basis}</span>
                    </dt>
                    <dd className="tabular font-semibold text-ink">
                      x {trimDecimal(factor.factor)}
                    </dd>
                  </div>
                ))}
              </dl>
            </td>
          </tr>
          <Step
            label="Location rate"
            formula={`${etb(land.tiers.averageRate)} x ${trimDecimal(land.factorProduct)}`}
            value={etb(land.ratePerSqm)}
            unit="per m²"
          />
          <Step
            label="Location value"
            formula={land.holding.formula}
            value={etb(land.locationValue)}
          />
          <Step
            label="Location value taken"
            formula={land.staged.formula}
            value={etb(land.value)}
            strong
          />
          {land.holdingRates ? (
            <tr>
              <td className={TD} colSpan={2}>
                <span className="font-medium text-ink">
                  Land holding rate for {trimDecimal(land.plotArea)} m² (ETB per m²)
                </span>
                <dl className="mt-1.5 grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-6">
                  {land.holdingRates.grades.map((rate, index) => (
                    <div key={index}>
                      <dt className="text-ink-3">Grade {index + 1}</dt>
                      <dd className="tabular font-semibold text-ink">{etb(rate)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-ink-3">Average taken</dt>
                    <dd className="tabular font-semibold text-ink">
                      {etb(land.holdingRates.averageTaken)}
                    </dd>
                  </div>
                </dl>
              </td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </section>
  );
}

/** The component rates behind a building's cost per m², as the Excel annex lists them. */
function ComponentDetail({
  building,
  progress,
}: {
  building: CivilBuildingOutput;
  progress: boolean;
}) {
  return (
    <table className="mt-2 w-full text-[11.5px]">
      <thead className="text-left text-ink-3">
        <tr>
          <th className="py-1 pr-2 font-semibold">Component</th>
          <th className="py-1 pr-2 font-semibold">Grade</th>
          <th className="py-1 pr-2 text-right font-semibold">Rate</th>
          <th className="py-1 pr-2 text-right font-semibold">Weight</th>
          <th className="py-1 pr-2 text-right font-semibold">Share</th>
          {progress ? <th className="py-1 pr-2 text-right font-semibold">Built</th> : null}
          <th className="py-1 text-right font-semibold">Per m²</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line/60">
        {building.components.map((c) => (
          <tr key={c.row}>
            <td className="py-1 pr-2 text-ink">
              {c.name}
              <span className="block text-[10.5px] text-ink-3">
                {c.element}
                {c.part ? ` · ${c.part}` : ''}
              </span>
            </td>
            <td className="py-1 pr-2 text-ink-2">{c.grade}</td>
            <td className="tabular py-1 pr-2 text-right">{etb(c.unitRate)}</td>
            <td className="tabular py-1 pr-2 text-right">{trimDecimal(c.weightPercent)}%</td>
            <td className="tabular py-1 pr-2 text-right">{trimDecimal(c.sharePercent)}%</td>
            {progress ? (
              <td className="tabular py-1 pr-2 text-right">{trimDecimal(c.completionPercent)}%</td>
            ) : null}
            <td className="tabular py-1 text-right font-semibold">
              {etb(progress ? c.currentCost : c.cost)}
            </td>
          </tr>
        ))}
        {building.newComponents.map((c, index) => (
          <tr key={`new-${index}`}>
            <td className="py-1 pr-2 text-ink">
              {c.description ?? c.category}
              <span className="block text-[10.5px] text-ink-3">New component · {c.category}</span>
            </td>
            <td className="py-1 pr-2 text-ink-2">—</td>
            <td className="tabular py-1 pr-2 text-right">{etb(c.unitRate)}</td>
            <td className="tabular py-1 pr-2 text-right">—</td>
            <td className="tabular py-1 pr-2 text-right">{trimDecimal(c.sharePercent)}%</td>
            {progress ? (
              <td className="tabular py-1 pr-2 text-right">{trimDecimal(c.completionPercent)}%</td>
            ) : null}
            <td className="tabular py-1 text-right font-semibold">
              {etb(progress ? c.currentCost : c.cost)}
            </td>
          </tr>
        ))}
        {building.defects.map((d) => (
          <tr key={`defect-${d.code}`}>
            <td className="py-1 pr-2 text-ink" colSpan={progress ? 6 : 5}>
              Defect: {d.label}
              <span className="block text-[10.5px] text-ink-3">
                {d.group} · {trimDecimal(d.ratePercent)}% x {trimDecimal(d.percent)}% affected (
                {building.defectCategory} rates)
              </span>
            </td>
            <td className="tabular py-1 text-right font-semibold">
              - {trimDecimal(d.depreciationPercent)}%
            </td>
          </tr>
        ))}
        {building.supplementary.map((w, index) => (
          <tr key={`supp-${index}`}>
            <td className="py-1 pr-2 text-ink" colSpan={progress ? 6 : 5}>
              Supplementary: {w.item}
              <span className="block text-[10.5px] text-ink-3">{w.formula}</span>
            </td>
            <td className="tabular py-1 text-right font-semibold">
              {etb(progress ? w.currentAmount : w.amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WorkRows({ works }: { works: readonly PricedItemOutput[] }) {
  return (
    <>
      {works.map((w, index) => (
        <tr key={index}>
          <td className={TD}>
            <span className="font-medium text-ink">{w.item}</span>
            <Formula>
              {w.description ? `${w.description} · ` : ''}
              {w.formula}
            </Formula>
          </td>
          <td className={NUM}>{w.kind === 'RATE' ? trimDecimal(w.quantity) : '—'}</td>
          <td className={NUM}>{etb(w.rate)}</td>
          <td className={NUM}>{etb(w.amount)}</td>
          <td className={NUM}>
            {w.amount === w.currentAmount ? '—' : `${trimDecimal(w.completionPercent)}% built`}
          </td>
          <td className={cn(NUM, 'font-semibold')}>{etb(w.currentAmount)}</td>
        </tr>
      ))}
    </>
  );
}

function CivilBreakdown({
  output,
  expanded,
}: {
  output: CivilEngineOutput;
  /** Show each building's component working open, as a printed report needs. */
  expanded: boolean;
}) {
  const progress = output.mode === 'PROGRESS';
  const works = [
    ...output.siteWorks.civil,
    ...output.siteWorks.gasStation,
    ...output.siteWorks.coffeeSite,
  ];
  return (
    <div className="space-y-6">
      <p className="text-[12.5px] text-ink-2">
        <span className="font-semibold text-ink">{output.property.propertyType}</span> on{' '}
        {output.property.purpose.toLowerCase()} land in{' '}
        <span className="font-semibold text-ink">{output.property.city}</span>
        {output.property.cityClass ? ` (${output.property.cityClass})` : ''} ·{' '}
        {progress ? 'valued as it stands, under construction' : 'valued complete'} · guideline{' '}
        {output.guideline.version}
      </p>

      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold text-ink">Buildings and site works</h3>
        <Table>
          <thead className="bg-surface-2">
            <tr>
              <th className={TH}>Item</th>
              <th className={cn(TH, 'text-right')}>Quantity</th>
              <th className={cn(TH, 'text-right')}>Rate (ETB)</th>
              <th className={cn(TH, 'text-right')}>Replacement cost</th>
              <th className={cn(TH, 'text-right')}>Depreciation / stage</th>
              <th className={cn(TH, 'text-right')}>Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {output.buildings.map((b) => {
              const stage = progress ? b.current : b.complete;
              return (
                <tr key={b.buildingId}>
                  <td className={TD}>
                    <span className="font-medium text-ink">
                      Building {b.buildingNumber} - {b.name}
                    </span>
                    <Formula>
                      {b.costType} · {CONSTRUCTION_LABELS[b.constructionStatus]}
                      <br />
                      {b.formula}
                    </Formula>
                    <details open={expanded} className="mt-1.5 text-[11.5px] text-ink-2">
                      <summary className="cursor-pointer font-semibold text-ink-2">
                        {b.components.length + b.newComponents.length} components
                        {b.defects.length > 0 ? `, ${b.defects.length} defects` : ''}
                        {b.supplementary.length > 0
                          ? `, ${b.supplementary.length} supplementary works`
                          : ''}
                      </summary>
                      <ComponentDetail building={b} progress={progress} />
                    </details>
                  </td>
                  <td className={NUM}>{trimDecimal(b.costedArea)} m²</td>
                  <td className={NUM}>{etb(stage.depreciatedRate)}</td>
                  <td className={NUM}>{etb(b.complete.replacementCost)}</td>
                  <td className={NUM}>
                    {Number(b.depreciationPercent) > 0
                      ? `- ${trimDecimal(b.depreciationPercent)}%`
                      : '—'}
                    {progress && b.constructionStatus === 'UNDER_CONSTRUCTION' ? (
                      <span className="block text-[11.5px] text-ink-3">
                        {trimDecimal(b.completionPercent)}% built
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(NUM, 'font-semibold')}>{etb(b.value)}</td>
                </tr>
              );
            })}
            <WorkRows works={works} />
            <TotalRow
              label="Buildings and site works"
              value={output.cost.developmentValue}
              colSpan={5}
            />
            <TotalRow
              label={
                <>
                  x market condition factor {trimDecimal(output.cost.factor)}
                  <Formula>
                    {output.property.purpose.toLowerCase()} property in {output.property.city}
                  </Formula>
                </>
              }
              value={output.cost.afterFactor}
              colSpan={5}
            />
          </tbody>
        </Table>
      </section>

      <LandWorking output={output} />

      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold text-ink">Cost approach</h3>
        <Table minWidth="36rem">
          <tbody className="divide-y divide-line">
            <Step label="Buildings and site works after MCF" value={etb(output.cost.afterFactor)} />
            <Step label="Location value taken" value={etb(output.cost.landValue)} />
            <Step
              label={progress ? 'Cost approach value at the current stage' : 'Cost approach value'}
              formula={output.cost.formula}
              value={etb(output.cost.indicatedValue)}
              strong
            />
            {output.progress ? (
              <Step
                label="Cost approach value at completion"
                formula={output.progress.formula}
                value={etb(output.progress.valueAtCompletion)}
              />
            ) : null}
          </tbody>
        </Table>
      </section>

      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold text-ink">Sale approach</h3>
        {output.sales.applicable ? (
          <Table minWidth="36rem">
            <tbody className="divide-y divide-line">
              <Step
                label="Sale value"
                formula={output.sales.formula}
                value={etb(output.sales.indicatedValue)}
                strong
              />
            </tbody>
          </Table>
        ) : (
          <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-2">
            {output.sales.reason}
          </p>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Civil, first formula (civil-1.0.0) - kept so issued reports still render
// ---------------------------------------------------------------------------

function LegacyCivilBreakdown({ output }: { output: LegacyCivilEngineOutput }) {
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-[14px] font-semibold text-ink">Cost approach</h3>
        <Table>
          <thead className="bg-surface-2">
            <tr>
              <th className={TH}>Item</th>
              <th className={cn(TH, 'text-right')}>Quantity</th>
              <th className={cn(TH, 'text-right')}>Rate (ETB)</th>
              <th className={cn(TH, 'text-right')}>Amount</th>
              <th className={cn(TH, 'text-right')}>Depreciation / adjustment</th>
              <th className={cn(TH, 'text-right')}>Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className={TD}>
                <span className="font-medium text-ink">Land</span>
                <Formula>{output.land.formula}</Formula>
              </td>
              <td className={NUM}>{trimDecimal(output.land.area)} m²</td>
              <td className={NUM}>{etb(output.land.ratePerSqm)}</td>
              <td className={NUM}>{etb(output.land.grossValue)}</td>
              <td className={NUM}>
                {output.land.value === output.land.grossValue
                  ? '—'
                  : `- ${etb(dec(output.land.grossValue).minus(output.land.value).toFixed(2))}`}
              </td>
              <td className={cn(NUM, 'font-semibold')}>{etb(output.land.value)}</td>
            </tr>
            {output.buildings.map((b) => (
              <tr key={b.buildingId}>
                <td className={TD}>
                  <span className="font-medium text-ink">
                    Building {b.buildingNumber} - {b.description}
                  </span>
                  <Formula>
                    {b.replacementFormula}
                    {b.depreciation ? (
                      <>
                        <br />
                        {METHOD_LABELS[b.depreciation.method] ?? b.depreciation.method}:{' '}
                        {b.depreciation.formula} = {trimDecimal(b.depreciation.ratePercent)}%
                      </>
                    ) : null}
                    <br />
                    {b.formula}
                  </Formula>
                </td>
                <td className={NUM}>{trimDecimal(b.area)} m²</td>
                <td className={NUM}>{etb(b.unitRate)}</td>
                <td className={NUM}>{etb(b.replacementCost)}</td>
                <td className={NUM}>
                  {b.depreciation
                    ? `- ${etb(b.depreciation.amount)}`
                    : `${trimDecimal(b.progressPercent)}% complete`}
                </td>
                <td className={cn(NUM, 'font-semibold')}>{etb(b.value)}</td>
              </tr>
            ))}
            {output.externalWorks.map((w, index) => (
              <tr key={index}>
                <td className={TD}>
                  <span className="font-medium text-ink">{w.description}</span>
                  <Formula>{w.formula}</Formula>
                </td>
                <td className={NUM}>
                  {trimDecimal(w.quantity)}
                  {w.unit ? ` ${w.unit}` : ''}
                </td>
                <td className={NUM}>{etb(w.rate)}</td>
                <td className={NUM}>{etb(w.amount)}</td>
                <td className={NUM}>—</td>
                <td className={cn(NUM, 'font-semibold')}>{etb(w.amount)}</td>
              </tr>
            ))}
            <TotalRow label="Subtotal" value={output.cost.subtotal} colSpan={5} />
            <TotalRow
              label={
                <>
                  Cost approach value
                  <Formula>{output.cost.formula}</Formula>
                </>
              }
              value={output.cost.indicatedValue}
              strong
              colSpan={5}
            />
          </tbody>
        </Table>
      </section>

      {output.sales ? (
        <section className="space-y-3">
          <h3 className="text-[14px] font-semibold text-ink">Sales approach</h3>
          <Table minWidth="52rem">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>Comparable</th>
                <th className={cn(TH, 'text-right')}>Sale price</th>
                <th className={cn(TH, 'text-right')}>Area m²</th>
                <th className={cn(TH, 'text-right')}>Per m²</th>
                <th className={cn(TH, 'text-right')}>Net adj.</th>
                <th className={cn(TH, 'text-right')}>Adjusted per m²</th>
                <th className={cn(TH, 'text-right')}>Indicated value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {output.sales.comparables.map((c, index) => (
                <tr key={index}>
                  <td className={TD}>
                    <span className="font-medium text-ink">
                      {index + 1}. {c.location}
                    </span>
                    <Formula>
                      {[c.reference, c.saleDate, c.characteristics].filter(Boolean).join(' · ') ||
                        '—'}
                    </Formula>
                  </td>
                  <td className={NUM}>{etb(c.salePrice)}</td>
                  <td className={NUM}>{trimDecimal(c.area)}</td>
                  <td className={NUM}>{etb(c.unitPrice)}</td>
                  <td className={NUM}>{trimDecimal(c.netAdjustmentPercent)}%</td>
                  <td className={NUM}>{etb(c.adjustedUnitPrice)}</td>
                  <td className={cn(NUM, 'font-semibold')}>{etb(c.adjustedValue)}</td>
                </tr>
              ))}
              <TotalRow
                label={
                  <>
                    Sales approach value
                    <Formula>{output.sales.formula}</Formula>
                  </>
                }
                value={output.sales.indicatedValue}
                strong
                colSpan={6}
              />
            </tbody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mechanical
// ---------------------------------------------------------------------------

function MechanicalBreakdown({ output }: { output: MechanicalEngineOutput }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[14px] font-semibold text-ink">Items</h3>
      <Table minWidth="56rem">
        <thead className="bg-surface-2">
          <tr>
            <th className={TH}>Item</th>
            <th className={cn(TH, 'text-right')}>Replacement cost</th>
            <th className={cn(TH, 'text-right')}>Depreciation</th>
            <th className={cn(TH, 'text-right')}>Cost value</th>
            <th className={cn(TH, 'text-right')}>Market value</th>
            <th className={cn(TH, 'text-right')}>Weights</th>
            <th className={cn(TH, 'text-right')}>Item value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {output.items.map((item) => (
            <tr key={item.itemId}>
              <td className={TD}>
                <span className="font-medium text-ink">
                  {item.kind === 'VEHICLE' ? 'Vehicle' : 'Machine'} {item.itemNumber} -{' '}
                  {item.description}
                </span>
                <Formula>
                  {humaniseKey(item.equipmentClass)}
                  {item.cost ? (
                    <>
                      <br />
                      {item.cost.replacementFormula}
                      <br />
                      {METHOD_LABELS[item.cost.depreciation.method] ??
                        item.cost.depreciation.method}
                      : {item.cost.depreciation.formula} ={' '}
                      {trimDecimal(item.cost.depreciation.ratePercent)}%
                      {Number(item.cost.conditionAdjustmentPercent) !== 0
                        ? `; condition ${trimDecimal(item.cost.conditionAdjustmentPercent)}%`
                        : ''}
                    </>
                  ) : null}
                  {item.market ? (
                    <>
                      <br />
                      Market: {item.market.formula} ({item.market.comparables.length} listed)
                    </>
                  ) : null}
                  <br />
                  {item.formula}
                </Formula>
              </td>
              <td className={NUM}>{item.cost ? etb(item.cost.replacementCost) : '—'}</td>
              <td className={NUM}>{item.cost ? `- ${etb(item.cost.depreciation.amount)}` : '—'}</td>
              <td className={NUM}>{item.cost ? etb(item.cost.value) : '—'}</td>
              <td className={NUM}>{item.market ? etb(item.market.value) : '—'}</td>
              <td className={NUM}>
                {trimDecimal(item.costWeight)} / {trimDecimal(item.marketWeight)}
              </td>
              <td className={cn(NUM, 'font-semibold')}>{etb(item.value)}</td>
            </tr>
          ))}
          <TotalRow
            label={`Total of ${output.totals.itemCount} item${output.totals.itemCount === 1 ? '' : 's'}`}
            value={output.marketValue}
            strong
            colSpan={6}
          />
        </tbody>
      </Table>
    </section>
  );
}

/**
 * The working itself - the approach tables, the reconciliation and the forced
 * sale - without the banners and run details around it. Shared by the
 * workspace and by the signed valuation report, which renders it from the
 * frozen document.
 */
export function WorkingTables({
  engine,
  output,
  expanded = false,
}: {
  engine: 'CIVIL' | 'MECHANICAL';
  output: unknown;
  /** Open each building's component working, for a printed report. */
  expanded?: boolean;
}) {
  // Entered figures have no working to show.
  if (isEnteredOutput(output)) return null;
  const legacy = engine === 'CIVIL' && isLegacyCivilOutput(output) ? output : null;
  const civil = engine === 'CIVIL' && !legacy ? (output as CivilEngineOutput) : null;
  const mechanical = engine === 'MECHANICAL' ? (output as MechanicalEngineOutput) : null;
  const shared = (civil ?? legacy ?? mechanical) as
    CivilEngineOutput | LegacyCivilEngineOutput | MechanicalEngineOutput;
  const reconciliation = shared.reconciliation;
  return (
    <div className="space-y-6">
      {civil ? <CivilBreakdown output={civil} expanded={expanded} /> : null}
      {legacy ? <LegacyCivilBreakdown output={legacy} /> : null}
      {mechanical ? <MechanicalBreakdown output={mechanical} /> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-(--radius-control) bg-surface-2 p-4">
          <p className="text-[12.5px] font-semibold text-ink">Reconciliation</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Cost {trimDecimal(reconciliation.costWeight)}% · sales / market{' '}
            {trimDecimal(reconciliation.salesWeight)}%
            {reconciliation.source === 'OVERRIDE' ? ' (overridden)' : ''}
            {reconciliation.source === 'GUIDELINE' ? ' (guideline weights)' : ''}
          </p>
          <Formula>{reconciliation.formula}</Formula>
          {reconciliation.rationale ? (
            <p className="mt-2 text-[12.5px] text-ink-2">Why: {reconciliation.rationale}</p>
          ) : null}
        </div>
        <div className="rounded-(--radius-control) bg-surface-2 p-4">
          <p className="text-[12.5px] font-semibold text-ink">Forced sale</p>
          <Formula>{shared.forcedSale.formula}</Formula>
          {shared.forcedSale.reason ? (
            <p className="mt-2 text-[12.5px] text-ink-2">Why: {shared.forcedSale.reason}</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
