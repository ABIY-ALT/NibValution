import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listMyTasks } from '@/server/application/case-service';
import { PageHero } from '@/components/layout/page-hero';
import { LIST_PAGE_SIZE, Pagination, pageHref, readPage } from '@/components/layout/list-controls';
import { StatusBadge } from '@/components/workflow/status-badge';
import { Badge } from '@/components/ui/badge';
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
import type { CaseStatus } from '@/server/domain/shared/enums';

export const dynamic = 'force-dynamic';

const TASK_LABELS: Record<string, string> = {
  ASSIGN_MAKER: 'Assign a valuator',
  PERFORM_VALUATION: 'Perform the valuation',
  ASSIGN_CHECKER: 'Assign a checker',
  PERFORM_CHECKING: 'Check the valuation',
  MANAGER_APPROVAL: 'Manager approval',
  DIRECTOR_APPROVAL: 'Director approval',
  SIGN: 'Sign the valuation',
  GENERATE_FINAL_LETTER: 'Issue the final letter',
  CORRECT_VALUATION: 'Correct and resubmit',
};

function dueLabel(dueAt: Date | null): { text: string; variant: 'active' | 'warning' | 'danger' } {
  if (!dueAt) return { text: 'No due date', variant: 'active' };

  const msLeft = dueAt.getTime() - Date.now();
  const days = Math.ceil(msLeft / 86_400_000);

  if (msLeft < 0) return { text: `${Math.abs(days)}d overdue`, variant: 'danger' };
  if (days <= 1) return { text: 'Due today', variant: 'warning' };
  return { text: `${days}d left`, variant: 'active' };
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  const { page } = await searchParams;
  const result = await listMyTasks(actor, { page: readPage(page), pageSize: LIST_PAGE_SIZE });
  const tasks = result.rows;

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Work Queue"
        title="My Tasks"
        subtitle="Work assigned to you, and the role queues you can pick up from. Tasks are opened and closed by the workflow engine, never by hand."
        actions={
          <>
            <Badge variant="brand" size="lg">
              {result.assigned} assigned
            </Badge>
            {result.queued > 0 ? (
              <Badge variant="accent" size="lg">
                {result.queued} in queue
              </Badge>
            ) : null}
          </>
        }
      />

      <TableWrap>
        <TableBar>
          <TableTitle>Open tasks</TableTitle>
          <Badge variant="default">{tasks.length} shown</Badge>
        </TableBar>
        <TableScroll>
          <Table>
            <THead>
              <TR>
                <TH>Case</TH>
                <TH>What is needed</TH>
                <TH>Owner</TH>
                <TH>Case status</TH>
                <TH>Due</TH>
                <TH>Source</TH>
              </TR>
            </THead>
            <TBody>
              {tasks.length === 0 ? (
                <EmptyRow colSpan={6} icon={Inbox} title="Nothing waiting on you">
                  Tasks appear here as cases reach a stage your role handles.
                </EmptyRow>
              ) : (
                tasks.map((task) => {
                  const due = dueLabel(task.dueAt);
                  return (
                    <TR key={task.id}>
                      <TD>
                        <Link
                          href={`/requests/${task.case.id}`}
                          className="font-bold text-nib-gold-700 transition-colors hover:text-nib-gold-600 hover:underline dark:text-nib-gold-400"
                        >
                          {task.case.caseNumber}
                        </Link>
                        <span className="block text-[11px] text-ink-3">
                          {task.case.requestType.name} ·{' '}
                          {task.case.discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}
                        </span>
                      </TD>
                      <TD className="text-[13px] font-medium">
                        {TASK_LABELS[task.taskType] ?? task.taskType}
                      </TD>
                      <TD className="text-[13px]">{task.case.ownerName}</TD>
                      <TD>
                        <StatusBadge status={task.case.status as CaseStatus} />
                      </TD>
                      <TD>
                        <Badge variant={due.variant}>{due.text}</Badge>
                      </TD>
                      <TD className="text-[12px] text-ink-3">
                        {task.assigneeId === actor.id ? (
                          <Badge variant="accent" size="sm">
                            Assigned to you
                          </Badge>
                        ) : (
                          `${task.roleCode} queue`
                        )}
                      </TD>
                    </TR>
                  );
                })
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        pageSize={result.pageSize}
        noun="tasks"
        buildHref={(p) => pageHref('/tasks', {}, p)}
      />
    </div>
  );
}
