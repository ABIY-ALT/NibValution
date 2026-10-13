import { Fragment } from 'react';
import {
  AlertTriangle,
  Calculator,
  CalendarClock,
  History,
  ListPlus,
  SlidersHorizontal,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listParameterSets } from '@/server/application/admin-service';
import { AccessDenied } from '@/components/admin/access-denied';
import {
  ParameterDialog,
  type ParameterOption,
  type ParameterSetOption,
} from '@/components/admin/parameter-dialog';
import { PageHero } from '@/components/layout/page-hero';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardIcon } from '@/components/ui/card';
import {
  EmptyRow,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import {
  PARAMETER_TYPE_INFO,
  formatNumericParameter,
  formatTableValue,
  humanizeEntry,
  isGuidelineTable,
  isUnconfirmed,
  parameterArea,
  tableEntries,
} from '@/lib/parameters';
import { PARAMETER_TYPES, type ParameterType } from '@/server/domain/shared/enums';

export const dynamic = 'force-dynamic';

type ParameterSet = Awaited<ReturnType<typeof listParameterSets>>[number];
type Parameter = ParameterSet['parameters'][number];

const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const APPLIES_TO: Record<string, string> = {
  CIVIL: 'Civil',
  MECHANICAL: 'Mechanical',
};

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The version the engine would choose today - the same rule as `loadParameterSnapshot`. */
function inForceAt(versions: ParameterSet[], at: Date): ParameterSet | null {
  return (
    versions
      .filter((v) => v.isActive && v.effectiveFrom <= at && (!v.effectiveTo || v.effectiveTo > at))
      .sort(
        (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.version - a.version,
      )[0] ?? null
  );
}

/** A parameter's value as the text the publish form edits. */
function toOption(parameter: Parameter, setCode: string): ParameterOption {
  return {
    setCode,
    key: parameter.key,
    name: parameter.name,
    type: parameter.type as ParameterType,
    numericValue: parameter.numericValue?.toString() ?? null,
    table: tableEntries(parameter.jsonValue).map(({ entry, value }) => ({
      entry,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    })),
    unit: parameter.unit,
    discipline:
      parameter.discipline === 'CIVIL' || parameter.discipline === 'MECHANICAL'
        ? parameter.discipline
        : null,
    notes: parameter.notes,
  };
}

function numericText(parameter: Parameter): string | null {
  return parameter.numericValue !== null
    ? formatNumericParameter(
        parameter.type as ParameterType,
        parameter.numericValue.toString(),
        parameter.unit,
      )
    : null;
}

/** What one version changed relative to the one before it, in words. */
function changesBetween(newer: ParameterSet, older: ParameterSet | undefined): string[] {
  if (!older) return ['First version'];

  const olderByKey = new Map(older.parameters.map((p) => [p.key, p]));
  const newerKeys = new Set(newer.parameters.map((p) => p.key));
  const changes: string[] = [];

  for (const parameter of newer.parameters) {
    const before = olderByKey.get(parameter.key);
    if (!before) {
      changes.push(`Added ${parameter.name}`);
      continue;
    }
    const valueChanged =
      before.numericValue?.toString() !== parameter.numericValue?.toString() ||
      JSON.stringify(before.jsonValue) !== JSON.stringify(parameter.jsonValue);
    if (valueChanged) {
      const was = numericText(before);
      const now = numericText(parameter);
      changes.push(was && now ? `${parameter.name}: ${was} → ${now}` : `Changed ${parameter.name}`);
    } else if (before.name !== parameter.name || before.notes !== parameter.notes) {
      changes.push(`Updated the description of ${parameter.name}`);
    }
  }
  for (const parameter of older.parameters) {
    if (!newerKeys.has(parameter.key)) changes.push(`Removed ${parameter.name}`);
  }
  return changes.length > 0 ? changes : ['No values changed'];
}

function ParameterValue({ parameter }: { parameter: Parameter }) {
  if (isGuidelineTable(parameter.key)) {
    return (
      <div className="space-y-1.5">
        <span className="block text-[12.5px] text-ink-2">Reference table</span>
        <Badge size="sm" title="Published with a guideline release; not edited here.">
          Guideline
        </Badge>
      </div>
    );
  }
  const numeric = numericText(parameter);
  const entries = tableEntries(parameter.jsonValue);

  return (
    <div className="space-y-1.5">
      {numeric ? (
        <span className="tabular block text-[15px] font-bold text-ink">{numeric}</span>
      ) : null}
      {entries.length > 0 ? (
        <dl className="grid w-fit min-w-[12rem] grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-(--radius-control) border border-line bg-surface-2/60 px-3 py-2 text-[12px]">
          {entries.map(({ entry, value }) => (
            <Fragment key={entry}>
              <dt className="text-ink-2" title={entry}>
                {entry === 'DEFAULT' ? 'Anything else' : humanizeEntry(entry)}
              </dt>
              <dd className="tabular text-right font-semibold text-ink">
                {formatTableValue(value)}
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : null}
      <Badge size="sm" title={PARAMETER_TYPE_INFO[parameter.type as ParameterType]?.blurb}>
        {PARAMETER_TYPE_INFO[parameter.type as ParameterType]?.label ?? parameter.type}
      </Badge>
    </div>
  );
}

export default async function ParametersPage() {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.PARAMETER_UPDATE)) {
    return <AccessDenied permission="parameter:update" what="valuation parameters" />;
  }
  const sets = await listParameterSets(actor);

  const now = new Date();
  const today = isoDay(now);

  // One entry per set code: every version (newest first), the one in force
  // today, and the newest, which a new version is built from.
  const groups = [...new Set(sets.map((s) => s.code))].map((code) => {
    const versions = sets.filter((s) => s.code === code);
    const latest = versions[0]!;
    return {
      code,
      versions,
      latest,
      inForce: inForceAt(versions, now),
      scheduled: versions.filter((v) => v.effectiveFrom > now),
    };
  });

  const setOptions: ParameterSetOption[] = groups.map(({ code, latest }) => ({
    code,
    latestVersion: latest.version,
    earliestDate: isoDay(latest.effectiveFrom) > today ? isoDay(latest.effectiveFrom) : today,
  }));
  const existing = groups.flatMap(({ code, latest }) =>
    latest.parameters
      .filter((parameter) => !isGuidelineTable(parameter.key))
      .map((parameter) => toOption(parameter, code)),
  );

  const provisionalCount = groups
    .flatMap(({ inForce }) => inForce?.parameters ?? [])
    .filter((parameter) => isUnconfirmed(parameter.notes)).length;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Valuation Parameters"
        subtitle="The percentages, factors and lookup tables the valuation engine uses to calculate a property’s value."
        actions={
          <>
            {provisionalCount > 0 ? (
              <Badge variant="warning" size="lg">
                {provisionalCount} provisional
              </Badge>
            ) : null}
            {setOptions.length > 0 ? (
              <ParameterDialog sets={setOptions} existing={existing} />
            ) : null}
          </>
        }
      />

      {/* How it works — read once, then out of the way. */}
      <Card>
        <div className="grid divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
          <section className="flex gap-3.5 p-5">
            <CardIcon icon={Calculator} />
            <div>
              <h2 className="text-[13.5px] font-bold text-ink">What a parameter is</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                A named value that a valuation formula reads — for example the forced-sale
                percentage, or the economic life of a masonry building. The engine looks each one up
                by its <span className="font-mono text-[11.5px]">key</span>.
              </p>
            </div>
          </section>

          <section className="flex gap-3.5 p-5">
            <CardIcon icon={History} tone="info" />
            <div>
              <h2 className="text-[13.5px] font-bold text-ink">Why there are versions</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                Values are never overwritten. Each change publishes a new version with the date it
                takes effect. A valuation keeps the version it was calculated with, so its figure
                can always be reproduced.
              </p>
            </div>
          </section>

          <section className="flex gap-3.5 p-5">
            <CardIcon icon={ListPlus} tone="good" />
            <div>
              <h2 className="text-[13.5px] font-bold text-ink">How to add or change one</h2>
              <ol className="mt-1 list-decimal space-y-1 pl-4 text-[12.5px] leading-relaxed text-ink-2 marker:font-semibold marker:text-ink-3">
                <li>
                  Choose <strong className="text-ink">Add parameter</strong> at the top, or{' '}
                  <strong className="text-ink">Change</strong> on a row below.
                </li>
                <li>Enter the value, the date it takes effect, and the reason.</li>
                <li>
                  <strong className="text-ink">Publish</strong>. Nothing already calculated is
                  affected.
                </li>
              </ol>
            </div>
          </section>
        </div>

        <div className="border-t border-line bg-surface-2/50 px-5 py-4">
          <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-3">
            Kinds of value
          </p>
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {PARAMETER_TYPES.map((type) => (
              <div key={type} className="text-[12px] leading-snug">
                <dt className="inline font-semibold text-ink">{PARAMETER_TYPE_INFO[type].label}</dt>
                <dd className="inline text-ink-3"> — {PARAMETER_TYPE_INFO[type].blurb}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      {provisionalCount > 0 ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>
            {provisionalCount} {provisionalCount === 1 ? 'value is' : 'values are'} provisional
          </AlertTitle>
          <AlertDescription>
            Values marked <strong>Provisional</strong> were set as working assumptions and have not
            yet been confirmed by the Property Valuation Department. Treat figures that depend on
            them as provisional until they are confirmed. Civil property rates and factors are not
            among them: they come from the valuation guideline tables.
          </AlertDescription>
        </Alert>
      ) : null}

      {groups.length === 0 ? (
        <Alert>
          <SlidersHorizontal aria-hidden="true" />
          <AlertTitle>No parameter sets</AlertTitle>
          <AlertDescription>No valuation parameter sets have been published yet.</AlertDescription>
        </Alert>
      ) : null}

      {groups.map(({ code, versions, latest, inForce, scheduled }) => {
        const shown = inForce ?? latest;
        const latestByKey = new Map(latest.parameters.map((p) => [p.key, p]));

        // Grouped by the area each key belongs to, in the order a valuation
        // applies them rather than alphabetically.
        const areas = new Map<
          string,
          { area: ReturnType<typeof parameterArea>; items: Parameter[] }
        >();
        for (const parameter of shown.parameters) {
          const area = parameterArea(parameter.key);
          const bucket = areas.get(area.id) ?? { area, items: [] };
          bucket.items.push(parameter);
          areas.set(area.id, bucket);
        }
        const orderedAreas = [...areas.values()].sort(
          (a, b) => a.area.order - b.area.order || a.area.title.localeCompare(b.area.title),
        );

        return (
          <Fragment key={code}>
            {scheduled.length > 0 ? (
              <Alert variant="info">
                <CalendarClock aria-hidden="true" />
                <AlertTitle>A newer version is scheduled</AlertTitle>
                <AlertDescription>
                  {scheduled
                    .map(
                      (v) => `Version ${v.version} takes effect on ${DATE.format(v.effectiveFrom)}`,
                    )
                    .join('; ')}
                  . The values below are the ones in force today. A change you publish now builds on
                  version {latest.version}.
                </AlertDescription>
              </Alert>
            ) : null}

            <TableWrap>
              <TableBar>
                <TableTitle>
                  <SlidersHorizontal className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
                  Values in force today
                  <span className="font-normal text-ink-3">
                    {code} · version {shown.version}
                  </span>
                </TableTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11.5px] text-ink-3">
                    Since {DATE.format(shown.effectiveFrom)} · {shown.parameters.length} parameters
                  </span>
                  <Badge variant={inForce ? 'success' : 'inactive'} size="sm">
                    {inForce ? 'In force' : 'Not in force'}
                  </Badge>
                </div>
              </TableBar>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Parameter</TH>
                      <TH>Value</TH>
                      <TH>Applies to</TH>
                      <TH className="text-right">
                        <span className="sr-only">Change</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {shown.parameters.length === 0 ? (
                      <EmptyRow colSpan={4} icon={SlidersHorizontal} title="Empty set">
                        This version contains no parameters.
                      </EmptyRow>
                    ) : (
                      orderedAreas.map(({ area, items }) => (
                        <Fragment key={area.id}>
                          <tr className="bg-surface-2/70">
                            <td colSpan={4} className="px-4 py-2.5">
                              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-2">
                                {area.title}
                              </span>
                              {area.blurb ? (
                                <span className="ml-2 text-[11.5px] text-ink-3">{area.blurb}</span>
                              ) : null}
                            </td>
                          </tr>
                          {items.map((parameter) => {
                            const provisional = isUnconfirmed(parameter.notes);
                            const editable = latestByKey.get(parameter.key) ?? parameter;
                            return (
                              // Keyed by the parameter key, not the row id: a
                              // publish replaces every id, and the open dialog
                              // must survive the refresh to show its result.
                              <TR key={parameter.key}>
                                <TD className="align-top">
                                  <div className="max-w-md">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-[13px] font-semibold text-ink">
                                        {parameter.name}
                                      </span>
                                      {provisional ? (
                                        <Badge variant="warning" size="sm">
                                          Provisional
                                        </Badge>
                                      ) : null}
                                    </div>
                                    <span className="mt-0.5 block font-mono text-[11px] text-ink-3">
                                      {parameter.key}
                                    </span>
                                    {parameter.notes ? (
                                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
                                        {parameter.notes}
                                      </p>
                                    ) : null}
                                  </div>
                                </TD>
                                <TD className="align-top">
                                  <ParameterValue parameter={parameter} />
                                </TD>
                                <TD className="whitespace-nowrap align-top text-[12.5px] text-ink-2">
                                  {parameter.discipline
                                    ? (APPLIES_TO[parameter.discipline] ??
                                      humanizeEntry(parameter.discipline))
                                    : 'All properties'}
                                </TD>
                                <TD className="align-top">
                                  <div className="flex justify-end">
                                    {isGuidelineTable(parameter.key) ? (
                                      <span className="text-[11.5px] text-ink-3">
                                        Guideline release
                                      </span>
                                    ) : (
                                      <ParameterDialog
                                        sets={setOptions}
                                        existing={[]}
                                        editing={toOption(editable, code)}
                                      />
                                    )}
                                  </div>
                                </TD>
                              </TR>
                            );
                          })}
                        </Fragment>
                      ))
                    )}
                  </TBody>
                </Table>
              </TableScroll>
            </TableWrap>

            <TableWrap>
              <TableBar>
                <TableTitle>
                  <History className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
                  Version history
                  <span className="font-normal text-ink-3">{code}</span>
                </TableTitle>
                <Badge variant="default">
                  {versions.length} {versions.length === 1 ? 'version' : 'versions'}
                </Badge>
              </TableBar>
              <TableScroll>
                <Table>
                  <THead>
                    <TR>
                      <TH>Version</TH>
                      <TH>In effect</TH>
                      <TH>What changed</TH>
                      <TH className="text-right">Valuations</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {versions.map((version, index) => {
                      const status =
                        version.id === inForce?.id
                          ? { label: 'In force', variant: 'success' as const }
                          : version.effectiveFrom > now
                            ? { label: 'Scheduled', variant: 'info' as const }
                            : !version.isActive
                              ? { label: 'Withdrawn', variant: 'inactive' as const }
                              : { label: 'Replaced', variant: 'inactive' as const };
                      const changes = changesBetween(version, versions[index + 1]);
                      return (
                        <TR key={version.id}>
                          <TD className="whitespace-nowrap align-top">
                            <span className="text-[13px] font-bold text-ink">
                              v{version.version}
                            </span>
                            <Badge variant={status.variant} size="sm" className="ml-2">
                              {status.label}
                            </Badge>
                          </TD>
                          <TD className="tabular whitespace-nowrap align-top text-[12px] text-ink-2">
                            {DATE.format(version.effectiveFrom)}
                            <span className="block text-[11px] text-ink-3">
                              {version.effectiveTo
                                ? `until ${DATE.format(version.effectiveTo)}`
                                : 'no end date'}
                            </span>
                          </TD>
                          <TD className="align-top text-[12.5px]">
                            <ul className="space-y-0.5 text-ink">
                              {changes.map((change) => (
                                <li key={change}>{change}</li>
                              ))}
                            </ul>
                            {version.description ? (
                              <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-3">
                                {version.description}
                              </p>
                            ) : null}
                          </TD>
                          <TD className="tabular whitespace-nowrap text-right align-top text-[12px] text-ink-2">
                            {version._count.valuations.toLocaleString()}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableScroll>
            </TableWrap>
          </Fragment>
        );
      })}
    </div>
  );
}
