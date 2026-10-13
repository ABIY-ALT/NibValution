'use client';

import { memo, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CivilGuide } from '@/server/domain/valuation/civil/guide';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Disclosure, Labelled, PercentInput, WorkRows } from './civil-worksheet-bits';
import { blankQuantity, type BuildingState } from './civil-worksheet-state';
import type { BuildingRow } from './civil-property';
import { CONSTRUCTION_LABELS, trimDecimal } from './labels';

type BuildingType = CivilGuide['buildingTypes'][number];
type Component = BuildingType['components'][number];

/** The components of a building type, in the guideline's elements and their parts. */
function groupComponents(type: BuildingType) {
  const groups: { element: string; parts: { part: string | null; components: Component[] }[] }[] =
    [];
  for (const component of type.components) {
    let group = groups[groups.length - 1];
    if (!group || group.element !== component.element) {
      group = { element: component.element, parts: [] };
      groups.push(group);
    }
    let part = group.parts[group.parts.length - 1];
    if (!part || part.part !== component.part) {
      part = { part: component.part, components: [] };
      group.parts.push(part);
    }
    part.components.push(component);
  }
  return groups;
}

const shareTotal = (state: BuildingState, components: readonly Component[]): number =>
  components.reduce((sum, c) => sum + (Number(state.components[String(c.row)]?.share) || 0), 0);

/**
 * How one registered building is priced: its guideline type, the components it
 * is built of with the share each makes up, its defects, and any works the
 * component list does not cover.
 */
export const BuildingPanel = memo(function BuildingPanel({
  building,
  state,
  guide,
  onChange,
}: {
  building: BuildingRow;
  state: BuildingState;
  guide: CivilGuide;
  onChange: (buildingId: string, change: (current: BuildingState) => BuildingState) => void;
}) {
  const id = `b-${building.id}`;
  const patch = (change: Partial<BuildingState>) =>
    onChange(building.id, (current) => ({ ...current, ...change }));

  const type = guide.buildingTypes.find((t) => t.name === state.costType) ?? null;
  const groups = useMemo(() => (type ? groupComponents(type) : []), [type]);
  const underConstruction = building.constructionStatus === 'UNDER_CONSTRUCTION';
  const selected = Object.values(state.components).filter((c) => c.share.trim() !== '').length;
  const defectsRecorded = Object.values(state.defects).filter((p) => p.trim() !== '').length;
  const defectGroups = useMemo(() => {
    const map = new Map<string, CivilGuide['defects'][number][]>();
    for (const defect of guide.defects) {
      map.set(defect.group, [...(map.get(defect.group) ?? []), defect]);
    }
    return [...map.entries()];
  }, [guide.defects]);

  const setComponent = (row: number, change: Partial<{ share: string; completion: string }>) =>
    onChange(building.id, (current) => {
      const entry = { share: '', completion: '', ...current.components[String(row)], ...change };
      const components = { ...current.components };
      // A component with nothing typed is not part of the building.
      if (entry.share.trim() === '' && entry.completion.trim() === '')
        delete components[String(row)];
      else components[String(row)] = entry;
      return { ...current, components };
    });

  return (
    <div className="space-y-4 rounded-(--radius-card) border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px] font-semibold text-ink">
          {building.buildingNumber}. {building.buildingType}
        </p>
        <p className="text-[12px] text-ink-3">
          {trimDecimal(building.grossArea ?? building.builtUpArea)} m² floor area
          {building.builtUpArea ? ` · ${trimDecimal(building.builtUpArea)} m² built-up` : ''} ·{' '}
          {CONSTRUCTION_LABELS[building.constructionStatus]}
          {underConstruction ? ` (${trimDecimal(building.progressPercent)}% registered)` : ''}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Labelled label="Guideline building type" htmlFor={`${id}-type`}>
          <Select
            id={`${id}-type`}
            value={state.costType}
            onChange={(e) =>
              // Each type has its own component list, so a change of type starts it afresh.
              patch({ costType: e.target.value, components: {} })
            }
          >
            <option value="">Choose…</option>
            {guide.buildingTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </Select>
        </Labelled>
        <Labelled
          label="Identical buildings"
          htmlFor={`${id}-count`}
          hint="How many buildings of exactly this size and make stand on the plot."
        >
          <Input
            id={`${id}-count`}
            inputMode="numeric"
            value={state.count}
            onChange={(e) => patch({ count: e.target.value })}
          />
        </Labelled>
        {type?.needsHeight ? (
          <Labelled
            label="Height (m)"
            htmlFor={`${id}-height`}
            hint="Halls and factories are priced by volume and height."
          >
            <Input
              id={`${id}-height`}
              inputMode="decimal"
              value={state.heightM}
              placeholder="e.g. 6"
              onChange={(e) => patch({ heightM: e.target.value })}
            />
          </Labelled>
        ) : null}
      </div>

      {type ? (
        <div className="space-y-2">
          <p className="text-[12px] text-ink-3">
            Enter the share of the building each component makes up - 100 where it is the only one
            of its kind, or e.g. 30 and 70 where two wall types are mixed. Leave the rest blank.
            {underConstruction
              ? ' "Built" is how far each is complete; blank takes the registered completion.'
              : ''}{' '}
            <span className="font-semibold text-ink-2">{selected} selected.</span>
          </p>
          {groups.map((group) => {
            const all = group.parts.flatMap((p) => p.components);
            const count = all.filter(
              (c) => (state.components[String(c.row)]?.share ?? '').trim() !== '',
            ).length;
            return (
              <Disclosure
                key={group.element}
                title={group.element}
                defaultOpen={count > 0}
                badge={
                  count > 0
                    ? `${count} selected · ${trimDecimal(shareTotal(state, all).toFixed(2))}%`
                    : null
                }
              >
                <div className="space-y-3">
                  {group.parts.map((part) => (
                    <div key={part.part ?? 'all'} className="space-y-1.5">
                      {part.part ? (
                        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
                          {part.part}
                        </p>
                      ) : null}
                      {part.components.map((component) => {
                        const entry = state.components[String(component.row)];
                        return (
                          <div
                            key={component.row}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0 text-[12.5px] text-ink">
                              {component.name}
                              <span className="ml-2 text-[11px] text-ink-3">
                                {component.grade} · weight {component.weightPercent}%
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <PercentInput
                                label={`Share of ${component.name}`}
                                value={entry?.share ?? ''}
                                onChange={(share) => setComponent(component.row, { share })}
                              />
                              {underConstruction ? (
                                <PercentInput
                                  label={`Completion of ${component.name}`}
                                  value={entry?.completion ?? ''}
                                  placeholder={trimDecimal(building.progressPercent)}
                                  disabled={(entry?.share ?? '').trim() === ''}
                                  onChange={(completion) =>
                                    setComponent(component.row, { completion })
                                  }
                                />
                              ) : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </Disclosure>
            );
          })}
        </div>
      ) : (
        <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
          Choose the guideline building type to list its components.
        </p>
      )}

      <Disclosure
        title="Condition defects"
        defaultOpen={defectsRecorded > 0}
        badge={defectsRecorded > 0 ? `${defectsRecorded} recorded` : 'depreciation'}
      >
        <p className="mb-3 text-[12px] text-ink-3">
          For each defect seen, enter how much of the element it affects (100 for all of it). Each
          depreciates the building by the guideline&apos;s rate for that defect.
        </p>
        <div className="space-y-3">
          {defectGroups.map(([group, defects]) => (
            <div key={group} className="space-y-1.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-3">
                {group}
              </p>
              {defects.map((defect) => (
                <div key={defect.code} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-[12.5px] text-ink">{defect.label}</span>
                  <PercentInput
                    label={`Affected share, ${defect.label}`}
                    value={state.defects[String(defect.code)] ?? ''}
                    onChange={(percent) =>
                      onChange(building.id, (current) => {
                        const defectsNow = { ...current.defects };
                        if (percent.trim() === '') delete defectsNow[String(defect.code)];
                        else defectsNow[String(defect.code)] = percent;
                        return { ...current, defects: defectsNow };
                      })
                    }
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Disclosure>

      <Disclosure
        title="Components not in the guideline list"
        defaultOpen={state.newComponents.length > 0}
        badge={state.newComponents.length > 0 ? `${state.newComponents.length} added` : null}
      >
        <div className="space-y-3">
          {state.newComponents.map((entry, index) => {
            const update = (change: Partial<typeof entry>) =>
              patch({
                newComponents: state.newComponents.map((n, i) =>
                  i === index ? { ...n, ...change } : n,
                ),
              });
            const rowId = `${id}-new-${index}`;
            return (
              <div key={index} className="flex flex-wrap items-end gap-3">
                <Labelled label="Category" htmlFor={`${rowId}-cat`} className="w-44">
                  <Select
                    id={`${rowId}-cat`}
                    value={entry.category}
                    onChange={(e) => update({ category: e.target.value })}
                  >
                    <option value="">Choose…</option>
                    {guide.newComponentCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </Select>
                </Labelled>
                <Labelled
                  label="Description"
                  htmlFor={`${rowId}-desc`}
                  className="min-w-[10rem] flex-1"
                >
                  <Input
                    id={`${rowId}-desc`}
                    value={entry.description}
                    onChange={(e) => update({ description: e.target.value })}
                  />
                </Labelled>
                <Labelled label="Price per m² (ETB)" htmlFor={`${rowId}-rate`} className="w-36">
                  <Input
                    id={`${rowId}-rate`}
                    inputMode="decimal"
                    value={entry.unitRate}
                    onChange={(e) => update({ unitRate: e.target.value })}
                  />
                </Labelled>
                <div className="space-y-1.5">
                  <span className="block text-[12px] font-semibold text-ink-2">Share</span>
                  <PercentInput
                    label="Share of the new component"
                    value={entry.share}
                    onChange={(share) => update({ share })}
                  />
                </div>
                {underConstruction ? (
                  <div className="space-y-1.5">
                    <span className="block text-[12px] font-semibold text-ink-2">Built</span>
                    <PercentInput
                      label="Completion of the new component"
                      value={entry.completion}
                      placeholder={trimDecimal(building.progressPercent)}
                      onChange={(completion) => update({ completion })}
                    />
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Remove"
                  onClick={() =>
                    patch({ newComponents: state.newComponents.filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 className="text-st-late" aria-hidden="true" />
                  <span className="sr-only">Remove new component {index + 1}</span>
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              patch({
                newComponents: [
                  ...state.newComponents,
                  { category: '', description: '', unitRate: '', share: '100', completion: '' },
                ],
              })
            }
          >
            <Plus aria-hidden="true" />
            Add a component
          </Button>
        </div>
      </Disclosure>

      <Disclosure
        title="Supplementary works on this building"
        defaultOpen={state.supplementary.length > 0}
        badge={state.supplementary.length > 0 ? `${state.supplementary.length} added` : null}
      >
        <WorkRows
          idPrefix={`${id}-supp`}
          listId="civil-supplementary-items"
          items={guide.supplementary}
          rows={state.supplementary}
          blank={blankQuantity}
          onChange={(supplementary) => patch({ supplementary })}
          addLabel="Add supplementary work"
          showCompletion={underConstruction}
        />
      </Disclosure>
    </div>
  );
});
