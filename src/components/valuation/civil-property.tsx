'use client';

import { useActionState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import {
  deleteBuildingAction,
  saveBuildingAction,
  saveCivilPropertyAction,
} from '@/server/actions/valuation-actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  CONDITION_GRADES,
  CONSTRUCTION_STATUSES,
  LAND_HOLDING_RIGHTS,
} from '@/server/domain/shared/enums';
import {
  ActionMessage,
  INITIAL_STATE,
  SpecFields,
  SubmitButton,
  type FieldSpec,
} from './form-bits';
import { DeleteItemButton, EntityDialog } from './entity-dialog';
import { CONDITION_LABELS, CONSTRUCTION_LABELS, HOLDING_LABELS, trimDecimal } from './labels';

export interface CategoryOption {
  code: string;
  name: string;
}

/** A registered building, with decimals already converted to strings. */
export interface BuildingRow {
  id: string;
  buildingNumber: number;
  buildingType: string;
  categoryCode: string | null;
  floorCount: number | null;
  grossArea: string | null;
  builtUpArea: string | null;
  constructionStatus: (typeof CONSTRUCTION_STATUSES)[number];
  constructionYear: number | null;
  condition: (typeof CONDITION_GRADES)[number] | null;
  progressPercent: string | null;
  remarks: string | null;
}

const options = <T extends string>(values: readonly T[], labels: Record<T, string>) =>
  values.map((value) => ({ value, label: labels[value] }));

// ---------------------------------------------------------------------------
// Land and property
// ---------------------------------------------------------------------------

export function CivilPropertyForm({
  caseId,
  categories,
  defaults,
  editable,
}: {
  caseId: string;
  categories: CategoryOption[];
  defaults: Record<string, string | number | null>;
  editable: boolean;
}) {
  const [state, formAction] = useActionState(saveCivilPropertyAction, INITIAL_STATE);

  const fields: FieldSpec[] = [
    {
      name: 'categoryCode',
      label: 'Property category',
      kind: 'select',
      required: true,
      options: categories.map((c) => ({ value: c.code, label: c.name })),
    },
    {
      name: 'landHoldingRight',
      label: 'Land holding right',
      kind: 'select',
      required: true,
      options: options(LAND_HOLDING_RIGHTS, HOLDING_LABELS),
    },
    {
      name: 'plotArea',
      label: 'Plot area',
      unit: 'm²',
      kind: 'number',
      hint: 'The land is valued on this area.',
    },
    { name: 'lhcNumber', label: 'LHC number' },
    { name: 'subCity', label: 'Sub-city' },
    { name: 'woreda', label: 'Woreda' },
    { name: 'kebele', label: 'Kebele' },
    { name: 'houseNumber', label: 'House number' },
    { name: 'geographicLocation', label: 'Location description' },
    { name: 'latitude', label: 'Latitude', kind: 'number', placeholder: 'e.g. 9.0054' },
    { name: 'longitude', label: 'Longitude', kind: 'number', placeholder: 'e.g. 38.7636' },
    {
      name: 'leaseRemainingYears',
      label: 'Remaining lease',
      unit: 'years',
      kind: 'number',
      hint: 'Required for lease-held land.',
    },
    { name: 'leaseUnpaidBalance', label: 'Unpaid lease balance', unit: 'ETB', kind: 'number' },
    { name: 'leaseAnnualRate', label: 'Annual lease payment', unit: 'ETB', kind: 'number' },
    { name: 'boundaryDescription', label: 'Boundaries', kind: 'textarea', span: 3 },
    { name: 'remarks', label: 'Remarks', kind: 'textarea', span: 3 },
  ];

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <input type="hidden" name="caseId" value={caseId} />
      <ActionMessage state={state} />
      <fieldset disabled={!editable} className="min-w-0 disabled:opacity-80">
        <SpecFields fields={fields} defaults={defaults} state={state} idPrefix="property" />
      </fieldset>
      {editable ? (
        <div className="flex justify-end">
          <SubmitButton>Save property details</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function buildingFields(categories: CategoryOption[]): FieldSpec[] {
  return [
    { name: 'buildingNumber', label: 'Building number', kind: 'number', required: true },
    {
      name: 'buildingType',
      label: 'Building',
      required: true,
      placeholder: 'e.g. G+2 residence',
    },
    {
      name: 'categoryCode',
      label: 'Category',
      kind: 'select',
      options: categories.map((c) => ({ value: c.code, label: c.name })),
    },
    {
      name: 'constructionStatus',
      label: 'Construction status',
      kind: 'select',
      required: true,
      options: options(CONSTRUCTION_STATUSES, CONSTRUCTION_LABELS),
    },
    { name: 'constructionYear', label: 'Year built', kind: 'number' },
    {
      name: 'condition',
      label: 'Condition',
      kind: 'select',
      options: options(CONDITION_GRADES, CONDITION_LABELS),
    },
    { name: 'floorCount', label: 'Floors', kind: 'number' },
    {
      name: 'grossArea',
      label: 'Gross area',
      unit: 'm²',
      kind: 'number',
      hint: 'The building is valued on this area.',
    },
    { name: 'builtUpArea', label: 'Built-up area', unit: 'm²', kind: 'number' },
    {
      name: 'progressPercent',
      label: 'Completion',
      unit: '%',
      kind: 'number',
      hint: 'Required when under construction.',
    },
    { name: 'remarks', label: 'Remarks', kind: 'textarea', span: 2 },
  ];
}

export function BuildingList({
  caseId,
  buildings,
  categories,
  editable,
  hasProperty,
}: {
  caseId: string;
  buildings: BuildingRow[];
  categories: CategoryOption[];
  editable: boolean;
  hasProperty: boolean;
}) {
  const fields = buildingFields(categories);
  const nextNumber = buildings.reduce((max, b) => Math.max(max, b.buildingNumber), 0) + 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-ink">
          Buildings <span className="font-normal text-ink-3">({buildings.length})</span>
        </h3>
        {editable && hasProperty ? (
          <EntityDialog
            title="Add a building"
            description="Recorded against this case's property. Its area and year feed the valuation."
            trigger={
              <Button size="sm" variant="outline">
                <Plus aria-hidden="true" />
                Add building
              </Button>
            }
            action={saveBuildingAction}
            hidden={{ caseId }}
            fields={fields}
            defaults={{ buildingNumber: nextNumber, constructionStatus: 'COMPLETED' }}
            submitLabel="Add building"
          />
        ) : null}
      </div>

      {!hasProperty ? (
        <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
          Save the land and property details first; buildings are recorded against them.
        </p>
      ) : buildings.length === 0 ? (
        <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
          No buildings recorded. Bare land is valued on the land alone.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-(--radius-control) border border-line">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-3">
              <tr>
                <th className="px-3 py-2.5 font-semibold">#</th>
                <th className="px-3 py-2.5 font-semibold">Building</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold">Year</th>
                <th className="px-3 py-2.5 text-right font-semibold">Gross area (m²)</th>
                <th className="px-3 py-2.5 font-semibold">Condition</th>
                {editable ? <th className="px-3 py-2.5" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {buildings.map((b) => (
                <tr key={b.id}>
                  <td className="tabular px-3 py-2.5 text-ink-3">{b.buildingNumber}</td>
                  <td className="px-3 py-2.5 font-medium text-ink">{b.buildingType}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant={b.constructionStatus === 'COMPLETED' ? 'default' : 'warning'}>
                      {CONSTRUCTION_LABELS[b.constructionStatus]}
                      {b.constructionStatus === 'UNDER_CONSTRUCTION' && b.progressPercent
                        ? ` · ${trimDecimal(b.progressPercent)}%`
                        : ''}
                    </Badge>
                  </td>
                  <td className="tabular px-3 py-2.5">{b.constructionYear ?? '—'}</td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {trimDecimal(b.grossArea ?? b.builtUpArea)}
                  </td>
                  <td className="px-3 py-2.5">
                    {b.condition ? CONDITION_LABELS[b.condition] : '—'}
                  </td>
                  {editable ? (
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <EntityDialog
                        title={`Edit building ${b.buildingNumber}`}
                        trigger={
                          <Button size="icon-sm" variant="ghost" title="Edit">
                            <Pencil aria-hidden="true" />
                            <span className="sr-only">Edit building {b.buildingNumber}</span>
                          </Button>
                        }
                        action={saveBuildingAction}
                        hidden={{ caseId, buildingId: b.id }}
                        fields={fields}
                        defaults={{ ...b }}
                        submitLabel="Save building"
                      />
                      <DeleteItemButton
                        action={deleteBuildingAction}
                        hidden={{ caseId, itemId: b.id }}
                        label={`Remove building ${b.buildingNumber}`}
                        confirmText={`Remove building ${b.buildingNumber}? The removal is recorded in the audit log.`}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
