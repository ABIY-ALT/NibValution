import { CalendarDays, Info, Timer } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { loadSlaSettings } from '@/server/application/sla-service';
import { removeHolidayAction } from '@/server/actions/admin-actions';
import { ActionForm } from '@/components/admin/action-form';
import { AccessDenied } from '@/components/admin/access-denied';
import { HolidayForm, SlaPolicyForm } from '@/components/admin/sla-settings-forms';
import { PageHero } from '@/components/layout/page-hero';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { WEEKDAYS } from '@/lib/validation/sla';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';
import { EmptyRow, TBody, TD, TH, THead, TR, Table, TableScroll } from '@/components/ui/table';

export const dynamic = 'force-dynamic';

const FULL_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY_MONTH = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export default async function SlaSettingsPage() {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.SLA_CONFIG)) {
    return <AccessDenied permission="sla:config" what="the SLA policy and holiday calendar" />;
  }

  const { policy, holidays, openRecords } = await loadSlaSettings(actor);
  const today = new Date().toISOString().slice(0, 10);
  const week = WEEKDAYS.filter((d) => policy?.workingDaysOfWeek.includes(d.day))
    .map((d) => d.short)
    .join(' · ');

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="SLA & Calendar"
        subtitle="The turnaround allowance every case is measured against, and the days that do not count towards it."
        actions={
          policy ? (
            <Badge variant="brand" size="lg">
              {policy.totalWorkingDays} {policy.countCalendarDays ? 'calendar' : 'working'} days
            </Badge>
          ) : null
        }
      />

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertTitle>Changes apply to open cases straight away</AlertTitle>
        <AlertDescription>
          Saving re-evaluates the {openRecords} open {openRecords === 1 ? 'case' : 'cases'} against
          the new calendar, so due dates and states move with it. Completed cases keep the figures
          they closed with. Every change is recorded in the audit log.
        </AlertDescription>
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Card className="self-start overflow-hidden">
          <CardBar>
            <CardTitle className="flex items-center gap-3">
              <CardIcon icon={Timer} />
              Turnaround policy
            </CardTitle>
            {week && !policy?.countCalendarDays ? (
              <span className="text-[12px] font-medium text-ink-3">{week}</span>
            ) : null}
          </CardBar>
          <CardContent className="pt-5">
            {policy ? (
              <SlaPolicyForm policy={policy} />
            ) : (
              <p className="py-6 text-center text-[13px] text-ink-3">
                The standard SLA policy has not been seeded. Run the database seed first.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardBar>
            <CardTitle className="flex items-center gap-3">
              <CardIcon icon={CalendarDays} />
              Public holidays
            </CardTitle>
            <Badge variant="default">{holidays.length} in the calendar</Badge>
          </CardBar>
          <CardContent className="space-y-5 pt-5">
            <HolidayForm />

            <TableScroll className="-mx-6 -mb-6 w-auto border-t border-line">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Holiday</TH>
                    <TH>Repeats</TH>
                    <TH className="text-right">
                      <span className="sr-only">Remove</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {holidays.length === 0 ? (
                    <EmptyRow colSpan={4} icon={CalendarDays} title="No holidays yet">
                      Until holidays are added, only the non-working days of the week are skipped.
                    </EmptyRow>
                  ) : (
                    holidays.map((holiday) => {
                      const key = holiday.date.toISOString().slice(0, 10);
                      const past = !holiday.isRecurring && key < today;
                      return (
                        <TR key={holiday.id} className={past ? 'opacity-55' : undefined}>
                          <TD className="tabular whitespace-nowrap text-[12.5px]">
                            {holiday.isRecurring
                              ? DAY_MONTH.format(holiday.date)
                              : FULL_DATE.format(holiday.date)}
                          </TD>
                          <TD className="font-semibold text-ink">{holiday.name}</TD>
                          <TD>
                            {holiday.isRecurring ? (
                              <Badge variant="accent" size="sm">
                                Every year
                              </Badge>
                            ) : (
                              <Badge variant="default" size="sm">
                                {past ? 'Passed' : 'Once'}
                              </Badge>
                            )}
                          </TD>
                          <TD className="text-right">
                            <ActionForm
                              action={removeHolidayAction}
                              label="Remove"
                              pendingLabel="Removing…"
                              variant="ghost"
                              confirm={`Remove ${holiday.name} from the calendar? Open cases will be re-evaluated without it.`}
                              hidden={{ holidayId: holiday.id }}
                            />
                          </TD>
                        </TR>
                      );
                    })
                  )}
                </TBody>
              </Table>
            </TableScroll>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
