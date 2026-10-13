'use client';

import { useActionState, useState } from 'react';
import { AlertTriangle, History, PencilLine, Plus, Send, Trash2 } from 'lucide-react';
import { publishParameterAction } from '@/server/actions/admin-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FormField,
  ResultBanner,
  SubmitButton,
  initialActionState,
  useAcknowledgeableResult,
} from '@/components/admin/create-form';
import { PARAMETER_TYPE_INFO, formatNumericParameter } from '@/lib/parameters';
import { PARAMETER_KEY_PATTERN } from '@/lib/validation/parameters';
import { PARAMETER_TYPES, type ParameterType } from '@/server/domain/shared/enums';

/** A parameter as the form pre-fills it: every value as the text it is edited as. */
export interface ParameterOption {
  setCode: string;
  key: string;
  name: string;
  type: ParameterType;
  numericValue: string | null;
  table: { entry: string; value: string }[];
  unit: string | null;
  discipline: 'CIVIL' | 'MECHANICAL' | null;
  notes: string | null;
}

/** A set a new version can be published for, and the earliest date it may start. */
export interface ParameterSetOption {
  code: string;
  latestVersion: number;
  /** `YYYY-MM-DD`: today, or the latest version's start if that is later. */
  earliestDate: string;
}

/** What the value box shows beside the number, so the unit is never guessed. */
const VALUE_SUFFIX: Partial<Record<ParameterType, string>> = {
  PERCENT: '%',
  FACTOR: '×',
  YEARS: 'years',
  AMOUNT: 'ETB',
};

const BLANK_ROW = { entry: '', value: '' };

function SectionHeading({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-nib-gold-500/15 text-[10px] text-nib-gold-700 dark:text-nib-gold-400">
        {step}
      </span>
      {children}
    </h3>
  );
}

/**
 * Add a valuation parameter, or change one.
 *
 * Both publish a new version of the set rather than editing a value in place,
 * and the dialog says so before anything is saved: the administrator should
 * know that the old value is kept, and from which date the new one applies.
 *
 * Opened from the page header it adds a parameter; opened from a row
 * (`editing`) it changes that one, with its key and type fixed - the engine
 * reads the key as one kind of value, and the server refuses a change of type
 * either way.
 */
export function ParameterDialog({
  sets,
  existing,
  editing,
}: {
  sets: ParameterSetOption[];
  existing: ParameterOption[];
  editing?: ParameterOption;
}) {
  const defaultSet = editing?.setCode ?? sets[0]?.code ?? '';
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [setCode, setSetCode] = useState(defaultSet);
  const [key, setKey] = useState(editing?.key ?? '');
  const [type, setType] = useState<ParameterType>(editing?.type ?? 'PERCENT');
  const [rows, setRows] = useState(editing?.table.length ? editing.table : [BLANK_ROW]);
  const [state, formAction] = useActionState(publishParameterAction, initialActionState);
  const [result, acknowledge] = useAcknowledgeableResult(state);

  const set = sets.find((s) => s.code === setCode) ?? sets[0];
  if (!set) return null;

  const published = result.ok && Boolean(result.message);
  const normalisedKey = key.trim().toLowerCase();
  const keyIsValid = PARAMETER_KEY_PATTERN.test(normalisedKey);
  // In add mode, a key that already exists belongs to its own row's editor.
  const clash = editing
    ? null
    : (existing.find((p) => p.setCode === setCode && p.key === normalisedKey) ?? null);
  const nextVersion = set.latestVersion + 1;

  function reset() {
    acknowledge();
    setSetCode(defaultSet);
    setKey(editing?.key ?? '');
    setType(editing?.type ?? 'PERCENT');
    setRows(editing?.table.length ? editing.table : [BLANK_ROW]);
    setFormKey((k) => k + 1);
  }

  return (
    <>
      {editing ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          aria-label={`Change ${editing.name}`}
        >
          <PencilLine aria-hidden="true" />
          Change
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Add parameter
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? `Change “${editing.name}”` : 'Add a valuation parameter'}
            </DialogTitle>
            <DialogDescription>
              {published ? (
                'The new version is saved, and the page behind this window now shows it.'
              ) : (
                <>
                  Saving publishes{' '}
                  <strong className="font-semibold text-ink">version {nextVersion}</strong> of{' '}
                  {set.code}. Version {set.latestVersion} is kept exactly as it is, so valuations
                  already done still reproduce their figures.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} key={formKey} noValidate className="contents">
            <input type="hidden" name="setCode" value={set.code} />

            <DialogBody className="space-y-6">
              <ResultBanner state={result} />

              {/* 1 — What the parameter is */}
              <section className="space-y-4">
                <SectionHeading step={1}>What it is</SectionHeading>

                {sets.length > 1 && !editing ? (
                  <FormField id="param-set" label="Parameter set" required>
                    <Select
                      id="param-set"
                      value={setCode}
                      onChange={(event) => setSetCode(event.target.value)}
                    >
                      {sets.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.code} (currently version {s.latestVersion})
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="param-name"
                    label="Name"
                    required
                    errors={result.fieldErrors?.name}
                    hint="What people will see, e.g. “Forced-sale percentage of market value”."
                  >
                    <Input
                      id="param-name"
                      name="name"
                      maxLength={120}
                      autoComplete="off"
                      defaultValue={editing?.name ?? ''}
                      aria-invalid={Boolean(result.fieldErrors?.name)}
                    />
                  </FormField>

                  <FormField
                    id="param-key"
                    label="Key"
                    required
                    errors={result.fieldErrors?.key}
                    hint={
                      editing
                        ? 'The name the valuation engine looks this up by. It cannot be changed.'
                        : 'The name the engine looks it up by: lower-case words joined by dots, e.g. forced_sale.percent.'
                    }
                  >
                    <Input
                      id="param-key"
                      name="key"
                      maxLength={80}
                      autoComplete="off"
                      spellCheck={false}
                      className="font-mono text-[12px] read-only:bg-surface-2 read-only:text-ink-2"
                      value={key}
                      readOnly={Boolean(editing)}
                      onChange={(event) => setKey(event.target.value)}
                      aria-invalid={Boolean(result.fieldErrors?.key)}
                    />
                  </FormField>
                </div>

                {clash ? (
                  <Alert variant="warning">
                    <AlertTriangle aria-hidden="true" />
                    <AlertDescription>
                      <strong className="font-semibold">{clash.name}</strong> already uses this key.
                      To change its value, close this window and choose <strong>Change</strong> on
                      its row.
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    id="param-type"
                    label="Kind of value"
                    required
                    errors={result.fieldErrors?.type}
                    hint={PARAMETER_TYPE_INFO[type].blurb}
                  >
                    {/* A disabled select posts nothing, so a fixed type travels
                        in a hidden field instead. */}
                    {editing ? <input type="hidden" name="type" value={type} /> : null}
                    <Select
                      id="param-type"
                      name={editing ? undefined : 'type'}
                      value={type}
                      disabled={Boolean(editing)}
                      onChange={(event) => setType(event.target.value as ParameterType)}
                    >
                      {PARAMETER_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {PARAMETER_TYPE_INFO[t].label}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  <FormField
                    id="param-discipline"
                    label="Applies to"
                    required
                    errors={result.fieldErrors?.discipline}
                    hint="Which properties this is meant for."
                  >
                    <Select
                      id="param-discipline"
                      name="discipline"
                      defaultValue={editing?.discipline ?? 'ALL'}
                    >
                      <option value="ALL">All properties</option>
                      <option value="CIVIL">Civil (land and buildings)</option>
                      <option value="MECHANICAL">Mechanical (vehicles and machinery)</option>
                    </Select>
                  </FormField>
                </div>
              </section>

              {/* 2 — The value */}
              <section className="space-y-4">
                <SectionHeading step={2}>The value</SectionHeading>

                {type === 'TABLE' ? (
                  <FormField
                    id="param-table"
                    label="Rows"
                    required
                    errors={result.fieldErrors?.table}
                    hint="One row per category. Add a DEFAULT row to cover any category not listed. Use true or false for yes/no settings."
                  >
                    <div id="param-table" className="space-y-2">
                      <div className="grid grid-cols-[1fr_1fr_2rem] gap-2 text-[10.5px] font-bold uppercase tracking-wider text-ink-3">
                        <span>Entry</span>
                        <span>Value</span>
                        <span />
                      </div>
                      {rows.map((row, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[1fr_1fr_2rem] items-center gap-2"
                        >
                          <Input
                            name="tableEntry"
                            aria-label={`Entry ${index + 1}`}
                            placeholder="e.g. RCC_FRAME"
                            className="font-mono text-[12px]"
                            spellCheck={false}
                            value={row.entry}
                            onChange={(event) =>
                              setRows((all) =>
                                all.map((r, i) =>
                                  i === index ? { ...r, entry: event.target.value } : r,
                                ),
                              )
                            }
                          />
                          <Input
                            name="tableValue"
                            aria-label={`Value ${index + 1}`}
                            placeholder="e.g. 60"
                            value={row.value}
                            onChange={(event) =>
                              setRows((all) =>
                                all.map((r, i) =>
                                  i === index ? { ...r, value: event.target.value } : r,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Remove row ${index + 1}`}
                            disabled={rows.length === 1}
                            onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRows((all) => [...all, BLANK_ROW])}
                      >
                        <Plus aria-hidden="true" />
                        Add row
                      </Button>
                    </div>
                  </FormField>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      id="param-value"
                      label="Value"
                      required
                      errors={result.fieldErrors?.numericValue}
                      hint={
                        editing?.numericValue
                          ? `Currently ${formatNumericParameter(editing.type, editing.numericValue, editing.unit)}.`
                          : 'Use a full stop for decimals, e.g. 0.85.'
                      }
                    >
                      <div className="relative">
                        <Input
                          id="param-value"
                          name="numericValue"
                          inputMode="decimal"
                          autoComplete="off"
                          defaultValue={editing?.numericValue ?? ''}
                          className={VALUE_SUFFIX[type] ? 'pr-14' : undefined}
                          aria-invalid={Boolean(result.fieldErrors?.numericValue)}
                        />
                        {VALUE_SUFFIX[type] ? (
                          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-ink-3">
                            {VALUE_SUFFIX[type]}
                          </span>
                        ) : null}
                      </div>
                    </FormField>

                    {type === 'RATE' || type === 'AMOUNT' ? (
                      <FormField
                        id="param-unit"
                        label="Unit"
                        errors={result.fieldErrors?.unit}
                        hint={type === 'RATE' ? 'e.g. ETB/m²' : 'Leave blank for ETB.'}
                      >
                        <Input
                          id="param-unit"
                          name="unit"
                          maxLength={20}
                          defaultValue={editing?.unit ?? ''}
                        />
                      </FormField>
                    ) : null}
                  </div>
                )}

                {type !== 'RATE' && type !== 'AMOUNT' ? (
                  <input
                    type="hidden"
                    name="unit"
                    value={type === 'PERCENT' ? '%' : (editing?.unit ?? '')}
                  />
                ) : null}

                <FormField
                  id="param-notes"
                  label="Notes"
                  errors={result.fieldErrors?.notes}
                  hint="Where the value comes from. While it is still provisional, include the words “Awaiting PVD confirmation” so it stays flagged."
                >
                  <Textarea
                    id="param-notes"
                    name="notes"
                    maxLength={1000}
                    rows={2}
                    defaultValue={editing?.notes ?? ''}
                  />
                </FormField>
              </section>

              {/* 3 — When, and why */}
              <section className="space-y-4">
                <SectionHeading step={3}>When and why</SectionHeading>

                <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
                  <FormField
                    id="param-effective"
                    label="Takes effect from"
                    required
                    errors={result.fieldErrors?.effectiveFrom}
                    hint="Applies to valuations dated on or after this day."
                  >
                    <Input
                      id="param-effective"
                      name="effectiveFrom"
                      type="date"
                      min={set.earliestDate}
                      defaultValue={set.earliestDate}
                      aria-invalid={Boolean(result.fieldErrors?.effectiveFrom)}
                    />
                  </FormField>

                  <FormField
                    id="param-reason"
                    label="Reason for this change"
                    required
                    errors={result.fieldErrors?.reason}
                    hint="Shown in the version history and the audit log."
                  >
                    <Textarea
                      id="param-reason"
                      name="reason"
                      rows={2}
                      maxLength={500}
                      placeholder="e.g. MCF confirmed by PVD memo of 28 Sept 2026"
                      aria-invalid={Boolean(result.fieldErrors?.reason)}
                    />
                  </FormField>
                </div>
              </section>

              {!published && !editing && keyIsValid && !clash ? (
                <Alert variant="warning">
                  <AlertTriangle aria-hidden="true" />
                  <AlertTitle>A new parameter does not change any figure on its own</AlertTitle>
                  <AlertDescription>
                    The valuation engine only reads the keys it was built to use. This one will be
                    stored in version {nextVersion} and listed on this page, but calculations will
                    not use <span className="font-mono text-[12px]">{normalisedKey}</span> until the
                    engine is updated to read it. To change a value the engine already uses, choose{' '}
                    <strong>Change</strong> on that parameter’s row instead.
                  </AlertDescription>
                </Alert>
              ) : null}

              {!published ? (
                <Alert variant="info">
                  <History aria-hidden="true" />
                  <AlertDescription>
                    Every other parameter is copied into version {nextVersion} unchanged. The
                    publication is recorded in the audit log with your name and reason.
                  </AlertDescription>
                </Alert>
              ) : null}
            </DialogBody>

            <DialogFooter>
              {published ? (
                <>
                  {!editing ? (
                    <Button type="button" variant="outline" onClick={reset}>
                      <Plus aria-hidden="true" />
                      Add another
                    </Button>
                  ) : null}
                  <Button type="button" onClick={() => setOpen(false)}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  {clash ? (
                    <Button type="button" disabled>
                      <Send aria-hidden="true" />
                      Publish version {nextVersion}
                    </Button>
                  ) : (
                    <SubmitButton
                      label={`Publish version ${nextVersion}`}
                      pendingLabel="Publishing…"
                      icon={<Send aria-hidden="true" />}
                    />
                  )}
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
