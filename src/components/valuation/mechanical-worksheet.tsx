'use client';

import { useActionState, useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { calculateAction } from '@/server/actions/valuation-actions';
import type { WorkspaceActionState } from '@/server/actions/valuation-actions';
import type { ParameterGuide } from '@/server/application/valuation-service';
import type { MechanicalWorksheet } from '@/lib/validation/valuation';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ActionMessage, INITIAL_STATE, SubmitButton } from './form-bits';
import { etb, humaniseKey } from './labels';

export interface MechanicalItemRow {
  id: string;
  kind: 'VEHICLE' | 'MACHINERY';
  itemNumber: number;
  description: string;
  manufactureYear: number | null;
  cifValue: string | null;
}

type Entry = MechanicalWorksheet['items'][number];
type Comparable = Entry['comparables'][number];

interface State {
  valuationDate: string;
  items: Record<string, Entry>;
  reconciliation: MechanicalWorksheet['reconciliation'];
  forcedSale: MechanicalWorksheet['forcedSale'];
  remarks: string;
}

const text = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : String(v);

function defaultEntry(item: MechanicalItemRow): Entry {
  return {
    itemId: item.id,
    kind: item.kind,
    costBasis: item.cifValue ? 'CIF' : 'QUOTE',
    cifValue: null,
    replacementQuote: null,
    equipmentClass: 'DEFAULT',
    effectiveAgeOverride: null,
    conditionAdjustmentPercent: '0',
    comparables: [],
  };
}

const BASIS_LABELS: Record<Entry['costBasis'], string> = {
  CIF: 'Cost from CIF',
  QUOTE: 'Cost from quote',
  NONE: 'Market only',
};

const blankComparable = (): Comparable => ({
  description: '',
  source: null,
  marketPrice: '',
  conditionAdjustment: '0',
  ageAdjustment: '0',
  locationAdjustment: '0',
  otherAdjustment: '0',
});

function Labelled({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[12px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
    </div>
  );
}

export function MechanicalWorksheetForm({
  caseId,
  guide,
  items,
  initial,
  today,
  canCalculate,
}: {
  caseId: string;
  guide: ParameterGuide;
  items: MechanicalItemRow[];
  initial: MechanicalWorksheet | null;
  today: string;
  canCalculate: boolean;
}) {
  const [ws, setWs] = useState<State>(() => {
    const saved = new Map((initial?.items ?? []).map((i) => [i.itemId, i]));
    return {
      valuationDate: initial?.valuationDate ?? today,
      items: Object.fromEntries(items.map((i) => [i.id, saved.get(i.id) ?? defaultEntry(i)])),
      reconciliation: initial?.reconciliation ?? {
        override: false,
        costWeight: guide.costWeight ?? '60',
        salesWeight: guide.salesWeight ?? '40',
        rationale: '',
      },
      forcedSale: initial?.forcedSale ?? {
        override: false,
        percent: guide.forcedSalePercent ?? '75',
        reason: '',
      },
      remarks: text(initial?.remarks),
    };
  });
  const [state, formAction] = useActionState<WorkspaceActionState, FormData>(
    calculateAction,
    INITIAL_STATE,
  );

  const setItem = (id: string, patch: Partial<Entry>) =>
    setWs((current) => {
      const existing = current.items[id];
      if (!existing) return current;
      return { ...current, items: { ...current.items, [id]: { ...existing, ...patch } } };
    });

  const err = (path: string) => state.fieldErrors?.[`worksheet.${path}`]?.[0];

  const payload = JSON.stringify({
    discipline: 'MECHANICAL',
    caseId,
    worksheet: {
      valuationDate: ws.valuationDate,
      items: items.map((i) => ws.items[i.id]),
      reconciliation: ws.reconciliation,
      forcedSale: ws.forcedSale,
      remarks: ws.remarks,
    },
  });

  const labelFor = (index: number) => {
    const item = items[index];
    return item
      ? `${item.kind === 'VEHICLE' ? 'Vehicle' : 'Machine'} ${item.itemNumber}`
      : `Item ${index + 1}`;
  };
  const issues = Object.entries(state.fieldErrors ?? {}).flatMap(([path, messages]) => {
    const match = /^worksheet\.items\.(\d+)/.exec(path);
    return messages.map((m) => (match ? `${labelFor(Number(match[1]))}: ${m}` : m));
  });

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="payload" value={payload} />

      {state.ok ? (
        <ActionMessage state={state} />
      ) : state.message ? (
        <ActionMessage
          state={{ ...state, messages: issues.length > 0 ? issues : state.messages }}
        />
      ) : null}

      <fieldset disabled={!canCalculate} className="min-w-0 space-y-6 disabled:opacity-80">
        <div className="grid gap-4 sm:grid-cols-3">
          <Labelled label="Date of valuation" htmlFor="mws-date">
            <Input
              id="mws-date"
              type="date"
              value={ws.valuationDate}
              max={today}
              onChange={(e) => setWs({ ...ws, valuationDate: e.target.value })}
            />
          </Labelled>
          <p className="self-end text-[12px] leading-relaxed text-ink-3 sm:col-span-2">
            Ages are taken at this date. CIF loadings (duty, freight, installation) total{' '}
            {guide.cifLoadingsPercent ?? '—'}%; depreciation is{' '}
            {guide.depreciationMethod ? humaniseKey(guide.depreciationMethod).toLowerCase() : '—'}{' '}
            with a {guide.residualPercent ?? '—'}% floor.
          </p>
        </div>

        {items.length === 0 ? (
          <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
            Register the vehicles and machinery above before valuing them.
          </p>
        ) : null}

        {items.map((item, index) => {
          const entry = ws.items[item.id];
          if (!entry) return null;
          const id = `item-${item.itemNumber}`;
          const path = `items.${index}`;
          const bad = (field: string) => (err(`${path}.${field}`) ? true : undefined);
          const updateComparable = (ci: number, patch: Partial<Comparable>) =>
            setItem(item.id, {
              comparables: entry.comparables.map((c, i) => (i === ci ? { ...c, ...patch } : c)),
            });

          return (
            <details
              key={item.id}
              open={items.length <= 6}
              className="group rounded-(--radius-control) border border-line"
            >
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-[13.5px] font-semibold text-ink">
                  {labelFor(index)}. {item.description}
                  {item.manufactureYear ? (
                    <span className="font-normal text-ink-3"> · {item.manufactureYear}</span>
                  ) : null}
                </span>
                <span className="text-[12px] text-ink-3">
                  {BASIS_LABELS[entry.costBasis]}
                  {entry.comparables.length > 0
                    ? ` · ${entry.comparables.length} comparable${entry.comparables.length === 1 ? '' : 's'}`
                    : ''}
                </span>
              </summary>

              <div className="space-y-4 border-t border-line px-4 py-4">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Labelled label="Equipment class" htmlFor={`${id}-class`}>
                    <Select
                      id={`${id}-class`}
                      value={entry.equipmentClass}
                      onChange={(e) => setItem(item.id, { equipmentClass: e.target.value })}
                    >
                      {guide.equipmentClasses.map((c) => (
                        <option key={c.key} value={c.key}>
                          {humaniseKey(c.key)} ({c.years} yrs)
                        </option>
                      ))}
                    </Select>
                  </Labelled>
                  <Labelled label="Cost basis" htmlFor={`${id}-basis`}>
                    <Select
                      id={`${id}-basis`}
                      value={entry.costBasis}
                      onChange={(e) =>
                        setItem(item.id, { costBasis: e.target.value as Entry['costBasis'] })
                      }
                    >
                      <option value="CIF">CIF value + loadings</option>
                      <option value="QUOTE">Quote for a new equivalent</option>
                      <option value="NONE">None - market approach only</option>
                    </Select>
                  </Labelled>
                  {entry.costBasis === 'CIF' ? (
                    <Labelled label="CIF value (ETB)" htmlFor={`${id}-cif`}>
                      <Input
                        id={`${id}-cif`}
                        inputMode="decimal"
                        value={text(entry.cifValue)}
                        placeholder={
                          item.cifValue ? `${etb(item.cifValue)} registered` : 'e.g. 1000000'
                        }
                        aria-invalid={bad('cifValue')}
                        onChange={(e) => setItem(item.id, { cifValue: e.target.value })}
                      />
                    </Labelled>
                  ) : entry.costBasis === 'QUOTE' ? (
                    <Labelled label="Replacement quote (ETB)" htmlFor={`${id}-quote`}>
                      <Input
                        id={`${id}-quote`}
                        inputMode="decimal"
                        value={text(entry.replacementQuote)}
                        aria-invalid={bad('replacementQuote')}
                        onChange={(e) => setItem(item.id, { replacementQuote: e.target.value })}
                      />
                    </Labelled>
                  ) : (
                    <div />
                  )}
                  {entry.costBasis !== 'NONE' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <Labelled label="Effective age" htmlFor={`${id}-age`}>
                        <Input
                          id={`${id}-age`}
                          inputMode="decimal"
                          value={text(entry.effectiveAgeOverride)}
                          placeholder="From year"
                          aria-invalid={bad('effectiveAgeOverride')}
                          onChange={(e) =>
                            setItem(item.id, { effectiveAgeOverride: e.target.value })
                          }
                        />
                      </Labelled>
                      <Labelled label="Condition adj. %" htmlFor={`${id}-cond`}>
                        <Input
                          id={`${id}-cond`}
                          inputMode="decimal"
                          value={entry.conditionAdjustmentPercent}
                          aria-invalid={bad('conditionAdjustmentPercent')}
                          onChange={(e) =>
                            setItem(item.id, { conditionAdjustmentPercent: e.target.value })
                          }
                        />
                      </Labelled>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <p className="text-[12px] font-semibold text-ink-2">
                    Market comparables{' '}
                    <span className="font-normal text-ink-3">
                      - adjustments are percentages applied to the listed price
                    </span>
                  </p>
                  {entry.comparables.map((c, ci) => (
                    <div
                      key={ci}
                      className="grid items-end gap-2 sm:grid-cols-[1.6fr_1fr_1fr_0.6fr_0.6fr_0.6fr_0.6fr_auto]"
                    >
                      <Labelled label="Description" htmlFor={`${id}-c${ci}-d`}>
                        <Input
                          id={`${id}-c${ci}-d`}
                          value={c.description}
                          aria-invalid={bad(`comparables.${ci}.description`)}
                          onChange={(e) => updateComparable(ci, { description: e.target.value })}
                        />
                      </Labelled>
                      <Labelled label="Source" htmlFor={`${id}-c${ci}-s`}>
                        <Input
                          id={`${id}-c${ci}-s`}
                          value={text(c.source)}
                          onChange={(e) => updateComparable(ci, { source: e.target.value })}
                        />
                      </Labelled>
                      <Labelled label="Price (ETB)" htmlFor={`${id}-c${ci}-p`}>
                        <Input
                          id={`${id}-c${ci}-p`}
                          inputMode="decimal"
                          value={c.marketPrice}
                          aria-invalid={bad(`comparables.${ci}.marketPrice`)}
                          onChange={(e) => updateComparable(ci, { marketPrice: e.target.value })}
                        />
                      </Labelled>
                      {(
                        [
                          ['conditionAdjustment', 'Cond.'],
                          ['ageAdjustment', 'Age'],
                          ['locationAdjustment', 'Loc.'],
                          ['otherAdjustment', 'Other'],
                        ] as const
                      ).map(([key, label]) => (
                        <Labelled key={key} label={`${label} %`} htmlFor={`${id}-c${ci}-${key}`}>
                          <Input
                            id={`${id}-c${ci}-${key}`}
                            inputMode="decimal"
                            value={c[key]}
                            aria-invalid={bad(`comparables.${ci}.${key}`)}
                            onChange={(e) => updateComparable(ci, { [key]: e.target.value })}
                          />
                        </Labelled>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        title="Remove"
                        onClick={() =>
                          setItem(item.id, {
                            comparables: entry.comparables.filter((_, i) => i !== ci),
                          })
                        }
                      >
                        <Trash2 className="text-st-late" aria-hidden="true" />
                        <span className="sr-only">Remove comparable {ci + 1}</span>
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setItem(item.id, { comparables: [...entry.comparables, blankComparable()] })
                    }
                  >
                    <Plus aria-hidden="true" />
                    Add comparable
                  </Button>
                </div>
              </div>
            </details>
          );
        })}

        <div className="grid gap-6 border-t border-line pt-5 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-3">
              An item valued both ways is weighted cost {guide.costWeight ?? '—'}% / market{' '}
              {guide.salesWeight ?? '—'}%.
            </p>
            <label className="flex items-center gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-nib-gold-600"
                checked={ws.reconciliation.override}
                onChange={(e) =>
                  setWs({
                    ...ws,
                    reconciliation: { ...ws.reconciliation, override: e.target.checked },
                  })
                }
              />
              Use different weights for this case
            </label>
            {ws.reconciliation.override ? (
              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Cost weight (%)" htmlFor="mws-cw">
                  <Input
                    id="mws-cw"
                    inputMode="decimal"
                    value={ws.reconciliation.costWeight}
                    onChange={(e) =>
                      setWs({
                        ...ws,
                        reconciliation: { ...ws.reconciliation, costWeight: e.target.value },
                      })
                    }
                  />
                </Labelled>
                <Labelled label="Market weight (%)" htmlFor="mws-sw">
                  <Input
                    id="mws-sw"
                    inputMode="decimal"
                    value={ws.reconciliation.salesWeight}
                    aria-invalid={err('reconciliation.salesWeight') ? true : undefined}
                    onChange={(e) =>
                      setWs({
                        ...ws,
                        reconciliation: { ...ws.reconciliation, salesWeight: e.target.value },
                      })
                    }
                  />
                </Labelled>
                <Labelled label="Why" htmlFor="mws-cw-why" className="col-span-2">
                  <Textarea
                    id="mws-cw-why"
                    rows={2}
                    value={ws.reconciliation.rationale}
                    aria-invalid={err('reconciliation.rationale') ? true : undefined}
                    onChange={(e) =>
                      setWs({
                        ...ws,
                        reconciliation: { ...ws.reconciliation, rationale: e.target.value },
                      })
                    }
                  />
                </Labelled>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-3">
              Configured forced-sale value: {guide.forcedSalePercent ?? '—'}% of market value.
            </p>
            <label className="flex items-center gap-2.5 text-[13px] text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-nib-gold-600"
                checked={ws.forcedSale.override}
                onChange={(e) =>
                  setWs({ ...ws, forcedSale: { ...ws.forcedSale, override: e.target.checked } })
                }
              />
              Use a different percentage for this case
            </label>
            {ws.forcedSale.override ? (
              <div className="grid grid-cols-2 gap-3">
                <Labelled label="Forced-sale %" htmlFor="mws-fs">
                  <Input
                    id="mws-fs"
                    inputMode="decimal"
                    value={ws.forcedSale.percent}
                    aria-invalid={err('forcedSale.percent') ? true : undefined}
                    onChange={(e) =>
                      setWs({ ...ws, forcedSale: { ...ws.forcedSale, percent: e.target.value } })
                    }
                  />
                </Labelled>
                <Labelled label="Why" htmlFor="mws-fs-why" className="col-span-2">
                  <Textarea
                    id="mws-fs-why"
                    rows={2}
                    value={ws.forcedSale.reason}
                    aria-invalid={err('forcedSale.reason') ? true : undefined}
                    onChange={(e) =>
                      setWs({ ...ws, forcedSale: { ...ws.forcedSale, reason: e.target.value } })
                    }
                  />
                </Labelled>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5 border-t border-line pt-5">
          <label htmlFor="mws-remarks" className="block text-[12px] font-semibold text-ink-2">
            Valuator&apos;s remarks
          </label>
          <Textarea
            id="mws-remarks"
            rows={3}
            value={ws.remarks}
            onChange={(e) => setWs({ ...ws, remarks: e.target.value })}
          />
        </div>
      </fieldset>

      {canCalculate ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="max-w-xl text-[12px] leading-relaxed text-ink-3">
            The figures are computed on the server from these inputs and the items as registered,
            and every calculation is kept so it can be reproduced.
          </p>
          <SubmitButton pendingLabel="Calculating…" disabled={items.length === 0}>
            <Calculator aria-hidden="true" />
            Calculate valuation
          </SubmitButton>
        </div>
      ) : null}
    </form>
  );
}
