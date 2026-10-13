import { cn } from '@/lib/utils';
import { CASE_STATUS_LABELS, type CaseStatus } from '@/server/domain/shared/enums';

/**
 * Status badges matched to NIB Board status color mappings.
 * Labels are always text-explicit for accessibility.
 */
const STATUS_CLASSES: Record<CaseStatus, string> = {
  DRAFT: 'bg-st-neutral-bg text-st-neutral border-st-neutral/30',
  REQUESTED: 'bg-st-info-bg text-st-info border-st-info/30',
  ASSIGNED: 'bg-st-info-bg text-st-info border-st-info/30',
  ON_PROGRESS: 'bg-st-active-bg text-st-active border-st-active/30',
  NOT_VISITED: 'bg-st-wait-bg text-st-wait border-st-wait/30',
  PENDING: 'bg-st-wait-bg text-st-wait border-st-wait/30',
  AWAITING_REQUESTER: 'bg-st-review-bg text-st-review border-st-review/30',
  SUBMITTED_FOR_CHECKING: 'bg-st-wait-bg text-st-wait border-st-wait/30',
  CHECKING: 'bg-st-wait-bg text-st-wait border-st-wait/30',
  COMMENTED: 'bg-st-review-bg text-st-review border-st-review/30',
  RETURNED_FOR_CORRECTION: 'bg-st-late-bg text-st-late border-st-late/30',
  CHECKED: 'bg-st-done-bg text-st-done border-st-done/30',
  PENDING_MANAGER_APPROVAL:
    'bg-nib-gold-100 text-nib-gold-700 border-nib-gold-500/30 dark:bg-nib-gold-500/15 dark:text-nib-gold-400',
  PENDING_DIRECTOR_APPROVAL:
    'bg-nib-gold-200 text-nib-gold-800 border-nib-gold-500/40 dark:bg-nib-gold-500/20 dark:text-nib-gold-300',
  APPROVED: 'bg-st-done-bg text-st-done border-st-done/30',
  SIGNED: 'bg-st-done-bg text-st-done border-st-done/40 font-semibold',
  COMPLETED: 'bg-st-done-bg text-st-done border-st-done/40 font-semibold',
  ARCHIVED: 'bg-st-neutral-bg text-st-neutral border-st-neutral/30',
  CANCELLED: 'bg-st-late-bg text-st-late border-st-late/30',
};

export function StatusBadge({ status, className }: { status: CaseStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap tabular',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}
