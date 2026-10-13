'use client';

import { useActionState, useState } from 'react';
import { CheckCircle2, CircleDot, MessageSquarePlus, Reply, RotateCcw } from 'lucide-react';
import {
  raiseCommentAction,
  replyCommentAction,
  resolveCommentAction,
} from '@/server/actions/review-actions';
import type { WorkspaceActionState } from '@/server/actions/valuation-actions';
import {
  REVIEW_SECTIONS,
  REVIEW_SECTION_LABELS,
  type ReviewSection,
} from '@/lib/validation/review';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ActionMessage, INITIAL_STATE, SubmitButton } from './form-bits';

export interface ReviewReplyView {
  id: string;
  body: string;
  author: string;
  authorIsChecker: boolean;
  createdAt: string;
}

export interface ReviewThreadView extends ReviewReplyView {
  section: string;
  isResolved: boolean;
  replies: ReviewReplyView[];
}

const STAMP = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

const sectionLabel = (section: string) =>
  REVIEW_SECTION_LABELS[section as ReviewSection] ?? section;

function Byline({ entry }: { entry: ReviewReplyView }) {
  return (
    <p className="text-[11.5px] text-ink-3">
      <span className="font-semibold text-ink-2">{entry.author}</span>
      {entry.authorIsChecker ? ' · checker' : ''} · {STAMP.format(new Date(entry.createdAt))}
    </p>
  );
}

function RaiseForm({ caseId, discipline }: { caseId: string; discipline: 'CIVIL' | 'MECHANICAL' }) {
  // Each successful comment remounts the form, clearing it for the next one.
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState<WorkspaceActionState, FormData>(
    async (prev, formData) => {
      const next = await raiseCommentAction(prev, formData);
      if (next.ok) setRound((r) => r + 1);
      return next;
    },
    INITIAL_STATE,
  );
  // Sections that cannot apply to this discipline are left out.
  const sections = REVIEW_SECTIONS.filter((s) =>
    discipline === 'CIVIL' ? s !== 'ITEMS' : s !== 'LAND' && s !== 'BUILDINGS',
  );
  return (
    <form
      action={formAction}
      key={round}
      className="space-y-3 rounded-(--radius-control) border border-line p-4"
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <MessageSquarePlus
          className="h-4 w-4 text-nib-gold-700 dark:text-nib-gold-400"
          aria-hidden="true"
        />
        Raise a review comment
      </p>
      <input type="hidden" name="caseId" value={caseId} />
      <ActionMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
        <Select name="section" aria-label="Section" defaultValue="GENERAL">
          {sections.map((s) => (
            <option key={s} value={s}>
              {REVIEW_SECTION_LABELS[s]}
            </option>
          ))}
        </Select>
        <Textarea
          name="body"
          rows={3}
          aria-label="Comment"
          placeholder="What should the valuator check or change, and why?"
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-ink-3">
          The first comment moves the case to Commented. Checking cannot complete while a comment is
          open.
        </p>
        <SubmitButton size="sm" pendingLabel="Raising…">
          Raise comment
        </SubmitButton>
      </div>
    </form>
  );
}

function ReplyForm({
  caseId,
  parentId,
  onDone,
}: {
  caseId: string;
  parentId: string;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<WorkspaceActionState, FormData>(
    async (prev, formData) => {
      const next = await replyCommentAction(prev, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="parentId" value={parentId} />
      {state.ok ? null : <ActionMessage state={state} />}
      <Textarea
        name="body"
        rows={2}
        aria-label="Reply"
        placeholder="Reply to this comment"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton size="sm" variant="outline" pendingLabel="Sending…">
          Reply
        </SubmitButton>
      </div>
    </form>
  );
}

function ResolveButton({
  caseId,
  commentId,
  resolved,
}: {
  caseId: string;
  commentId: string;
  resolved: boolean;
}) {
  const [state, formAction] = useActionState<WorkspaceActionState, FormData>(
    resolveCommentAction,
    INITIAL_STATE,
  );
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="commentId" value={commentId} />
      <input type="hidden" name="resolved" value={resolved ? 'false' : 'true'} />
      <SubmitButton size="sm" variant={resolved ? 'ghost' : 'outline'} pendingLabel="Saving…">
        {resolved ? (
          <>
            <RotateCcw aria-hidden="true" />
            Reopen
          </>
        ) : (
          <>
            <CheckCircle2 aria-hidden="true" />
            Mark resolved
          </>
        )}
      </SubmitButton>
      {!state.ok && state.message ? (
        <span role="alert" className="text-[11.5px] font-semibold text-st-late">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function Thread({
  caseId,
  thread,
  canReply,
  canResolve,
}: {
  caseId: string;
  thread: ReviewThreadView;
  canReply: boolean;
  canResolve: boolean;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <li
      className={cn(
        'rounded-(--radius-control) border p-4',
        thread.isResolved ? 'border-line bg-surface-2/60' : 'border-st-review/35 bg-surface',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent">{sectionLabel(thread.section)}</Badge>
          {thread.isResolved ? (
            <Badge variant="success">
              <CheckCircle2 aria-hidden="true" />
              Resolved
            </Badge>
          ) : (
            <Badge variant="warning">
              <CircleDot aria-hidden="true" />
              Open
            </Badge>
          )}
        </div>
        <Byline entry={thread} />
      </div>
      <p className="mt-2 whitespace-pre-line text-[13.5px] leading-relaxed text-ink wrap-anywhere">
        {thread.body}
      </p>

      {thread.replies.length > 0 ? (
        <ol className="mt-3 space-y-2 border-l-2 border-line pl-4">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <Byline entry={reply} />
              <p className="mt-0.5 whitespace-pre-line text-[13px] leading-relaxed text-ink-2 wrap-anywhere">
                {reply.body}
              </p>
            </li>
          ))}
        </ol>
      ) : null}

      {replying ? (
        <ReplyForm caseId={caseId} parentId={thread.id} onDone={() => setReplying(false)} />
      ) : canReply || canResolve ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canReply ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplying(true)}>
              <Reply aria-hidden="true" />
              Reply
            </Button>
          ) : null}
          {canResolve ? (
            <ResolveButton caseId={caseId} commentId={thread.id} resolved={thread.isResolved} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * The checker's review: comments tagged by section, answered in threads, and
 * resolved by the checker. Open comments are listed first.
 */
export function ReviewPanel({
  caseId,
  discipline,
  threads,
  canRaise,
  canReply,
  canResolve,
}: {
  caseId: string;
  discipline: 'CIVIL' | 'MECHANICAL';
  threads: ReviewThreadView[];
  canRaise: boolean;
  canReply: boolean;
  canResolve: boolean;
}) {
  const ordered = [...threads].sort((a, b) => Number(a.isResolved) - Number(b.isResolved));
  return (
    <div className="space-y-4">
      {canRaise ? <RaiseForm caseId={caseId} discipline={discipline} /> : null}
      {ordered.length === 0 ? (
        <p className="rounded-(--radius-control) bg-surface-2 px-4 py-3 text-[12.5px] text-ink-3">
          No review comments. The checker raises them here while checking the valuation.
        </p>
      ) : (
        <ol className="space-y-3">
          {ordered.map((thread) => (
            <Thread
              key={thread.id}
              caseId={caseId}
              thread={thread}
              canReply={canReply}
              canResolve={canResolve}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
