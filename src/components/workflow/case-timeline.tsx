import { CASE_STATUS_LABELS, type CaseStatus } from '@/server/domain/shared/enums';

export interface TimelineEntry {
  id: string;
  fromStatus: CaseStatus | null;
  toStatus: CaseStatus;
  action: string;
  actorName: string;
  actorRole: string;
  comment: string | null;
  occurredAt: string;
  durationSeconds: number | null;
}

/** Humanise a duration. Precision drops as the span grows, as a reader's would. */
function formatDuration(seconds: number | null): string | null {
  if (seconds === null || seconds < 60) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * The case timeline (spec section 32): who did what, when, with what comment,
 * and how long the case sat in the previous state.
 *
 * The duration is the number a manager actually needs — it turns the history
 * from a list of events into evidence of where time is going.
 */
export function CaseTimeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-[12px] text-ink-3">
        Nothing has happened yet. The timeline records every transition from submission onwards.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {entries.map((entry) => {
        const held = formatDuration(entry.durationSeconds);
        return (
          <li key={entry.id} className="relative">
            <span
              className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-nib-gold-500 ring-4 ring-surface"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold">
                {CASE_STATUS_LABELS[entry.toStatus] ?? entry.toStatus}
              </span>
              {entry.fromStatus ? (
                <span className="text-[11px] text-ink-3">
                  from {CASE_STATUS_LABELS[entry.fromStatus] ?? entry.fromStatus}
                </span>
              ) : null}
              {held ? <span className="text-[11px] text-ink-3">· held {held}</span> : null}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {entry.actorName} · {entry.actorRole} · {formatWhen(entry.occurredAt)}
            </p>
            {entry.comment ? (
              <p className="mt-1.5 rounded-control bg-surface-2 px-2.5 py-1.5 text-[12px]">
                {entry.comment}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
