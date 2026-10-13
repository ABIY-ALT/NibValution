'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertCircle,
  Archive,
  Ban,
  CheckCircle2,
  CirclePause,
  CircleSlash,
  CircleX,
  ClipboardCheck,
  FileCheck2,
  MapPinOff,
  MessageSquareText,
  PenLine,
  Play,
  RotateCcw,
  Send,
  Stamp,
  Truck,
  Undo2,
  UserPlus,
} from 'lucide-react';
import { transitionAction, type CaseFormState } from '@/server/actions/case-actions';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

const initialState: CaseFormState = { ok: false };

export interface AssigneeOption {
  id: string;
  fullName: string;
  discipline: string;
}

/**
 * Icons are named rather than passed as components: the specs are built on the
 * server, and a component cannot cross into a client component as a prop.
 */
const ACTION_ICONS = {
  send: Send,
  cancel: CircleX,
  undo: Undo2,
  assign: UserPlus,
  start: Play,
  pause: CirclePause,
  'not-visited': MapPinOff,
  comment: MessageSquareText,
  check: ClipboardCheck,
  document: FileCheck2,
  resubmit: RotateCcw,
  approve: Stamp,
  reject: Ban,
  sign: PenLine,
  deliver: Truck,
  archive: Archive,
} as const;

export type ActionIconName = keyof typeof ACTION_ICONS;

export interface ActionSpec {
  action: string;
  label: string;
  icon?: ActionIconName;
  variant?: ButtonProps['variant'];
  /** A comment or remark the workflow guard requires. */
  requiresComment?: boolean;
  commentLabel?: string;
  /** Choosing a maker or checker. */
  requiresAssignee?: boolean;
  assigneeLabel?: string;
  /** Signing: the password is re-entered in the same step (section 19). */
  requiresPassword?: boolean;
  confirm?: string;
}

function ActionIcon({ name }: { name?: ActionIconName }) {
  if (!name) return null;
  const Icon = ACTION_ICONS[name];
  return <Icon aria-hidden="true" />;
}

function Submit({ spec }: { spec: ActionSpec }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={spec.variant} disabled={pending} className="flex-1">
      <ActionIcon name={spec.icon} />
      {pending ? 'Working…' : spec.label}
    </Button>
  );
}

/**
 * The action buttons for a case.
 *
 * Which actions appear is decided on the server from the same transition table
 * the server enforces, so this component can never offer something that would
 * be refused. It only renders what it is given, and collects the extra input a
 * particular action needs — a mandatory comment on a return, an assignee on an
 * assignment.
 */
export function WorkflowActions({
  caseId,
  version,
  actions,
  assignees,
}: {
  caseId: string;
  version: number;
  actions: ActionSpec[];
  assignees: AssigneeOption[];
}) {
  const [state, formAction] = useActionState(transitionAction, initialState);
  const [open, setOpen] = useState<string | null>(null);

  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-(--radius-control) bg-surface-2 px-4 py-6 text-center">
        <CircleSlash className="h-5 w-5 text-ink-3" aria-hidden="true" />
        <p className="mt-2 text-[12.5px] text-ink-3">
          No actions are available to you on this case in its current state.
        </p>
      </div>
    );
  }

  const expanded = actions.find((a) => a.action === open);

  return (
    <div className="space-y-3">
      {state.message ? (
        <Alert variant={state.ok ? 'success' : 'destructive'}>
          {state.ok ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <AlertCircle className="h-4 w-4" aria-hidden />
          )}
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      ) : null}

      {expanded ? (
        <form action={formAction} className="space-y-3 rounded-card border border-line p-3">
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <input type="hidden" name="action" value={expanded.action} />

          {expanded.requiresAssignee ? (
            <div className="space-y-1.5">
              <Label htmlFor="assigneeId" required className="text-[12px] font-semibold">
                {expanded.assigneeLabel ?? 'Assign to'}
              </Label>
              <select
                id="assigneeId"
                name="assigneeId"
                required
                defaultValue=""
                className="h-9 w-full rounded-control border border-line bg-surface px-2.5 text-[13px]"
              >
                <option value="" disabled>
                  Choose a valuator…
                </option>
                {assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName} · {person.discipline}
                  </option>
                ))}
              </select>
              {assignees.length === 0 ? (
                <p className="text-[11px] text-st-late">
                  No eligible valuator is available for this discipline.
                </p>
              ) : null}
            </div>
          ) : null}

          {expanded.requiresComment ? (
            <div className="space-y-1.5">
              <Label htmlFor="comment" required className="text-[12px] font-semibold">
                {expanded.commentLabel ?? 'Comment'}
              </Label>
              <textarea
                id="comment"
                name="comment"
                rows={3}
                required
                minLength={10}
                className="w-full rounded-control border border-line bg-surface px-2.5 py-2 text-[13px]"
              />
              <p className="text-[11px] text-ink-3">
                The recipient sees only this comment, so it needs to say what to change.
              </p>
            </div>
          ) : null}

          {expanded.requiresPassword ? (
            <div className="space-y-1.5">
              <Label htmlFor="password" required className="text-[12px] font-semibold">
                Your password
              </Label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="h-10 w-full rounded-control border border-line bg-surface px-3 text-[13px]"
              />
              <p className="text-[11px] text-ink-3">
                Signing is personal: re-entering your password confirms it is you. The signed report
                can never be changed afterwards.
              </p>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <Submit spec={expanded} />
            <Button type="button" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        // One action per row at full width: a sidebar button reads as a clear
        // choice, and a long label never wraps a row of neighbours.
        <div className="grid gap-2.5">
          {actions.map((spec) => {
            const needsInput =
              spec.requiresComment || spec.requiresAssignee || spec.requiresPassword;

            if (needsInput) {
              return (
                <Button
                  key={spec.action}
                  type="button"
                  variant={spec.variant}
                  className="w-full"
                  onClick={() => setOpen(spec.action)}
                >
                  <ActionIcon name={spec.icon} />
                  {spec.label}
                </Button>
              );
            }

            return (
              <form key={spec.action} action={formAction}>
                <input type="hidden" name="caseId" value={caseId} />
                <input type="hidden" name="expectedVersion" value={version} />
                <input type="hidden" name="action" value={spec.action} />
                <SimpleSubmit spec={spec} />
              </form>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SimpleSubmit({ spec }: { spec: ActionSpec }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={spec.variant}
      disabled={pending}
      className="w-full"
      onClick={(event) => {
        if (spec.confirm && !window.confirm(spec.confirm)) event.preventDefault();
      }}
    >
      <ActionIcon name={spec.icon} />
      {pending ? 'Working…' : spec.label}
    </Button>
  );
}
