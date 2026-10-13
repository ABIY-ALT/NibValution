'use client';

import { useActionState } from 'react';
import { Car, Cog, Pencil, Plus } from 'lucide-react';
import {
  deleteMechanicalItemAction,
  saveMachineryAction,
  saveMechanicalPropertyAction,
  saveVehicleAction,
} from '@/server/actions/valuation-actions';
import { Button } from '@/components/ui/button';
import { CONDITION_GRADES } from '@/server/domain/shared/enums';
import {
  ActionMessage,
  INITIAL_STATE,
  SpecFields,
  SubmitButton,
  type FieldSpec,
} from './form-bits';
import { DeleteItemButton, EntityDialog } from './entity-dialog';
import { CONDITION_LABELS, etb } from './labels';
import type { CategoryOption } from './civil-property';

type Row = Record<string, string | number | null> & { id: string; itemNumber: number };

const conditionOptions = CONDITION_GRADES.map((value) => ({
  value,
  label: CONDITION_LABELS[value],
}));

// ---------------------------------------------------------------------------
// Site
// ---------------------------------------------------------------------------

export function MechanicalSiteForm({
  caseId,
  defaults,
  editable,
}: {
  caseId: string;
  defaults: Record<string, string | null>;
  editable: boolean;
}) {
  const [state, formAction] = useActionState(saveMechanicalPropertyAction, INITIAL_STATE);
  const fields: FieldSpec[] = [
    { name: 'plantName', label: 'Plant or fleet name' },
    { name: 'installationAddress', label: 'Installation address' },
    { name: 'operationalStatus', label: 'Operational status', placeholder: 'e.g. In operation' },
    { name: 'remarks', label: 'Remarks', kind: 'textarea', span: 3 },
  ];
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="caseId" value={caseId} />
      <ActionMessage state={state} />
      <fieldset disabled={!editable} className="min-w-0 disabled:opacity-80">
        <SpecFields fields={fields} defaults={defaults} state={state} idPrefix="site" />
      </fieldset>
      {editable ? (
        <div className="flex justify-end">
          <SubmitButton variant="outline">Save site details</SubmitButton>
        </div>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function vehicleFields(categories: CategoryOption[]): FieldSpec[] {
  return [
    { name: 'make', label: 'Make', placeholder: 'e.g. Toyota' },
    { name: 'model', label: 'Model', placeholder: 'e.g. Hilux' },
    { name: 'manufactureYear', label: 'Year of manufacture', kind: 'number' },
    { name: 'plateNumber', label: 'Plate number' },
    { name: 'chassisNumber', label: 'Chassis number' },
    { name: 'engineNumber', label: 'Engine number' },
    {
      name: 'categoryCode',
      label: 'Category',
      kind: 'select',
      options: categories.map((c) => ({ value: c.code, label: c.name })),
    },
    { name: 'condition', label: 'Condition', kind: 'select', options: conditionOptions },
    { name: 'mileage', label: 'Mileage', unit: 'km', kind: 'number' },
    { name: 'capacity', label: 'Capacity', placeholder: 'e.g. 1 tonne' },
    { name: 'horsePower', label: 'Horse power', kind: 'number' },
    { name: 'cylinderCount', label: 'Cylinders', kind: 'number' },
    { name: 'axleNumber', label: 'Axles', kind: 'number' },
    { name: 'colour', label: 'Colour' },
    { name: 'libreReference', label: 'Libre reference' },
    { name: 'ownerName', label: 'Registered owner', span: 2 },
    { name: 'remarks', label: 'Remarks', kind: 'textarea', span: 3 },
  ];
}

function machineryFields(categories: CategoryOption[]): FieldSpec[] {
  return [
    {
      name: 'equipmentName',
      label: 'Equipment',
      required: true,
      placeholder: 'e.g. Injection moulder',
    },
    { name: 'manufacturer', label: 'Manufacturer' },
    { name: 'model', label: 'Model' },
    { name: 'serialNumber', label: 'Serial number' },
    { name: 'manufactureYear', label: 'Year of manufacture', kind: 'number' },
    {
      name: 'categoryCode',
      label: 'Category',
      kind: 'select',
      options: categories.map((c) => ({ value: c.code, label: c.name })),
    },
    { name: 'condition', label: 'Condition', kind: 'select', options: conditionOptions },
    { name: 'capacity', label: 'Capacity' },
    { name: 'countryOfOrigin', label: 'Country of origin' },
    { name: 'installationLocation', label: 'Installed at' },
    {
      name: 'cifValue',
      label: 'CIF value',
      unit: 'ETB',
      kind: 'number',
      hint: 'Used by the CIF cost basis.',
    },
    { name: 'purchasePrice', label: 'Purchase price', unit: 'ETB', kind: 'number' },
    { name: 'insuranceValue', label: 'Insured value', unit: 'ETB', kind: 'number' },
    { name: 'remainingLifeYears', label: 'Remaining life', unit: 'years', kind: 'number' },
    { name: 'ownerName', label: 'Registered owner' },
    { name: 'remarks', label: 'Remarks', kind: 'textarea', span: 3 },
  ];
}

function ItemTable({
  caseId,
  kind,
  rows,
  fields,
  editable,
  columns,
}: {
  caseId: string;
  kind: 'VEHICLE' | 'MACHINERY';
  rows: Row[];
  fields: FieldSpec[];
  editable: boolean;
  columns: { key: string; label: string; align?: 'right'; format?: (v: Row) => string }[];
}) {
  const noun = kind === 'VEHICLE' ? 'vehicle' : 'machine';
  const action = kind === 'VEHICLE' ? saveVehicleAction : saveMachineryAction;
  const idField = kind === 'VEHICLE' ? 'vehicleId' : 'machineryId';

  if (rows.length === 0) {
    return (
      <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
        No {noun === 'vehicle' ? 'vehicles' : 'machinery'} recorded.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-(--radius-control) border border-line">
      <table className="w-full text-[13px]">
        <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-3">
          <tr>
            <th className="px-3 py-2.5 font-semibold">#</th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.label}
              </th>
            ))}
            {editable ? <th className="px-3 py-2.5" /> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="tabular px-3 py-2.5 text-ink-3">{row.itemNumber}</td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2.5 ${c.align === 'right' ? 'tabular text-right' : ''}`}
                >
                  {c.format ? c.format(row) : (row[c.key] ?? '—')}
                </td>
              ))}
              {editable ? (
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <EntityDialog
                    title={`Edit ${noun} ${row.itemNumber}`}
                    trigger={
                      <Button size="icon-sm" variant="ghost" title="Edit">
                        <Pencil aria-hidden="true" />
                        <span className="sr-only">
                          Edit {noun} {row.itemNumber}
                        </span>
                      </Button>
                    }
                    action={action}
                    hidden={{ caseId, [idField]: row.id }}
                    fields={fields}
                    defaults={row}
                    submitLabel={`Save ${noun}`}
                  />
                  <DeleteItemButton
                    action={deleteMechanicalItemAction}
                    hidden={{ caseId, itemId: row.id, kind }}
                    label={`Remove ${noun} ${row.itemNumber}`}
                    confirmText={`Remove ${noun} ${row.itemNumber}? The removal is recorded in the audit log.`}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MechanicalItems({
  caseId,
  vehicles,
  machinery,
  categories,
  editable,
}: {
  caseId: string;
  vehicles: Row[];
  machinery: Row[];
  categories: CategoryOption[];
  editable: boolean;
}) {
  const vehicleSpec = vehicleFields(categories);
  const machinerySpec = machineryFields(categories);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Car className="h-4 w-4 text-ink-3" aria-hidden="true" />
            Vehicles <span className="font-normal text-ink-3">({vehicles.length})</span>
          </h3>
          {editable ? (
            <EntityDialog
              title="Add a vehicle"
              description="Copy the particulars from the Libre."
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden="true" />
                  Add vehicle
                </Button>
              }
              action={saveVehicleAction}
              hidden={{ caseId }}
              fields={vehicleSpec}
              defaults={{}}
              submitLabel="Add vehicle"
            />
          ) : null}
        </div>
        <ItemTable
          caseId={caseId}
          kind="VEHICLE"
          rows={vehicles}
          fields={vehicleSpec}
          editable={editable}
          columns={[
            {
              key: 'make',
              label: 'Vehicle',
              format: (v) => [v.make, v.model].filter(Boolean).join(' ') || '—',
            },
            { key: 'plateNumber', label: 'Plate' },
            { key: 'manufactureYear', label: 'Year' },
            {
              key: 'condition',
              label: 'Condition',
              format: (v) =>
                v.condition ? CONDITION_LABELS[v.condition as keyof typeof CONDITION_LABELS] : '—',
            },
          ]}
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <Cog className="h-4 w-4 text-ink-3" aria-hidden="true" />
            Machinery <span className="font-normal text-ink-3">({machinery.length})</span>
          </h3>
          {editable ? (
            <EntityDialog
              title="Add a machine"
              description="Copy the particulars from the invoice and packing list."
              trigger={
                <Button size="sm" variant="outline">
                  <Plus aria-hidden="true" />
                  Add machine
                </Button>
              }
              action={saveMachineryAction}
              hidden={{ caseId }}
              fields={machinerySpec}
              defaults={{}}
              submitLabel="Add machine"
            />
          ) : null}
        </div>
        <ItemTable
          caseId={caseId}
          kind="MACHINERY"
          rows={machinery}
          fields={machinerySpec}
          editable={editable}
          columns={[
            { key: 'equipmentName', label: 'Equipment' },
            { key: 'serialNumber', label: 'Serial' },
            { key: 'manufactureYear', label: 'Year' },
            {
              key: 'cifValue',
              label: 'CIF (ETB)',
              align: 'right',
              format: (v) => (v.cifValue ? etb(String(v.cifValue)) : '—'),
            },
          ]}
        />
      </section>
    </div>
  );
}
