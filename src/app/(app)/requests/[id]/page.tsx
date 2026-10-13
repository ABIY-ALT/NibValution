import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  BadgeCheck,
  Building,
  Building2,
  Calculator,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Cog,
  FilePlus2,
  HardHat,
  History,
  Landmark,
  Link2,
  MessageSquareText,
  MessagesSquare,
  Paperclip,
  Phone,
  Route,
  Send,
  ShieldCheck,
  Stamp,
  Target,
  Timer,
  Undo2,
  User,
  UserPen,
  UserPlus,
  UserSquare,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { actionsFor, getCase, listAssignableValuators } from '@/server/application/case-service';
import {
  loadSiteVisitEvidence,
  loadValuationSummary,
} from '@/server/application/valuation-service';
import { SiteVisitCheckBadge } from '@/components/valuation/site-visit-check';
import { countOpenComments } from '@/server/application/review-service';
import { loadApprovalRecord } from '@/server/application/signature-service';
import { listCaseDocuments } from '@/server/application/case-document-service';
import { DocumentsCard } from '@/components/reports/documents-card';
import { ApprovalRecordCard } from '@/components/workflow/approval-record';
import { REVIEW_SECTION_LABELS, type ReviewSection } from '@/lib/validation/review';
import { canAccessCase } from '@/server/domain/rbac/authorize';
import { buttonVariants } from '@/components/ui/button';
import {
  listDocumentCategories,
  listDocuments,
  missingMandatoryCategories,
} from '@/server/application/document-service';
import { DocumentPanel } from '@/components/documents/document-panel';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { StatusBadge } from '@/components/workflow/status-badge';
import { CaseTimeline } from '@/components/workflow/case-timeline';
import {
  WorkflowActions,
  type ActionSpec,
  type AssigneeOption,
} from '@/components/workflow/workflow-actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardBar, CardContent, CardIcon, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/money';
import { NotFoundError } from '@/lib/errors';
import type { CaseStatus } from '@/server/domain/shared/enums';
import type { WorkflowAction } from '@/server/domain/workflow/transitions';

export const dynamic = 'force-dynamic';

/**
 * How each workflow action is presented, and what extra input it needs.
 *
 * The *availability* of an action is decided on the server from the transition
 * table; this map only supplies the wording and the form fields, so the two
 * cannot drift into offering something the engine would refuse.
 */
const ACTION_PRESENTATION: Record<string, Omit<ActionSpec, 'action'>> = {
  SUBMIT_REQUEST: { icon: 'send', label: 'Submit to department', variant: 'default' },
  RETURN_TO_REQUESTER: {
    icon: 'undo',
    label: 'Return to requester',
    variant: 'soft-danger',
    requiresComment: true,
    commentLabel: 'Reason for returning',
  },
  ASSIGN_MAKER: {
    icon: 'assign',
    label: 'Assign valuator',
    requiresAssignee: true,
    assigneeLabel: 'Assign to Maker',
  },
  START_VALUATION: { icon: 'start', label: 'Start valuation' },
  MARK_NOT_VISITED: {
    icon: 'not-visited',
    label: 'Mark not visited',
    variant: 'outline',
    requiresComment: true,
    commentLabel: 'Why the site could not be visited',
  },
  MARK_PENDING: {
    icon: 'pause',
    label: 'Mark pending',
    variant: 'outline',
    requiresComment: true,
    commentLabel: 'What the valuation is waiting on',
  },
  RESUME_VALUATION: { icon: 'start', label: 'Resume valuation' },
  SUBMIT_FOR_CHECKING: { icon: 'send', label: 'Submit for checking' },
  ASSIGN_CHECKER: {
    icon: 'assign',
    label: 'Assign checker',
    requiresAssignee: true,
    assigneeLabel: 'Assign to Checker',
  },
  // ADD_CHECKER_COMMENT is deliberately absent: review comments are raised in
  // the valuation workspace, where each is tagged with the section it concerns.
  COMPLETE_CHECKING: {
    icon: 'check',
    label: 'Complete checking',
    confirm:
      'Complete checking? The valuation is marked checked and returns to the valuator for the cover page.',
  },
  SUBMIT_FOR_APPROVAL: { icon: 'document', label: 'Generate cover page & submit for approval' },
  RETURN_FOR_CORRECTION: {
    icon: 'undo',
    label: 'Return for correction',
    variant: 'soft-danger',
    requiresComment: true,
    commentLabel: 'What must be corrected',
  },
  RESUBMIT: {
    icon: 'resubmit',
    label: 'Resubmit for checking',
    requiresComment: true,
    commentLabel: 'What was corrected',
  },
  APPROVE_MANAGER: { icon: 'approve', label: 'Approve', confirm: 'Approve this valuation?' },
  APPROVE_DIRECTOR: {
    icon: 'approve',
    label: 'Approve as Director',
    confirm: 'Approve this valuation?',
  },
  REJECT: {
    icon: 'reject',
    label: 'Reject',
    variant: 'soft-danger',
    requiresComment: true,
    commentLabel: 'Reason for rejection',
  },
  SIGN: {
    icon: 'sign',
    label: 'Sign valuation',
    requiresPassword: true,
  },
  GENERATE_FINAL_LETTER: { icon: 'document', label: 'Issue final letter' },
  DELIVER: { icon: 'deliver', label: 'Deliver to requester' },
  ARCHIVE: { icon: 'archive', label: 'Archive', variant: 'outline' },
  CANCEL: {
    icon: 'cancel',
    label: 'Cancel request',
    variant: 'soft-danger',
    requiresComment: true,
    commentLabel: 'Reason for cancelling',
    confirm: 'Cancel this request?',
  },
};

function formatDateTime(value: Date | null): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

/**
 * One fact about the case, led by an icon plate. The plate sits inside the
 * `<dt>` and is positioned against the row, so the list stays valid `<dl>`
 * markup while the value lines up under the label.
 */
function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 pl-12">
      <dt className="text-[12px] text-ink-3">
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 ring-1 ring-line"
        >
          <Icon className="h-4 w-4" />
        </span>
        {label}
      </dt>
      <dd className="mt-0.5 text-[13.5px] font-medium text-ink wrap-anywhere">{children}</dd>
    </div>
  );
}

/** A secondary line under a detail's value: a phone number, an employee id. */
function DetailNote({ icon: Icon, children }: { icon?: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] font-normal text-ink-3">
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/**
 * Free text the requester wrote, on a tinted panel across the full width.
 * `wrap-anywhere` lets an unbroken run of characters wrap rather than push
 * through the card's edge.
 */
function Narrative({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-(--radius-control) bg-surface-2 p-4 sm:col-span-2 xl:col-span-3">
      <dt className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
        <Icon className="h-4 w-4 text-nib-gold-700 dark:text-nib-gold-400" aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

interface Milestone {
  label: string;
  at: Date | null;
  icon: LucideIcon;
}

/**
 * The case's milestones as a vertical stepper: a reached step is a filled gold
 * disc with its date, one still ahead an outlined disc. The connecting rule
 * turns gold as far as the case has got.
 */
function ProgressSteps({ steps }: { steps: Milestone[] }) {
  return (
    <ol>
      {steps.map((step, index) => {
        const done = step.at !== null;
        const next = steps[index + 1];
        const Icon = step.icon;
        return (
          <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
            {next ? (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-0 left-[17px] top-9 w-0.5',
                  next.at ? 'bg-nib-gold-500' : 'bg-line',
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                done
                  ? 'bg-nib-gold-500 text-nib-brown-900 shadow-brand'
                  : 'bg-surface text-ink-3 ring-1 ring-line-strong',
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className={cn('text-[13px] font-semibold', done ? 'text-ink' : 'text-ink-3')}>
                {step.label}
                <span className="sr-only">{done ? ' (done)' : ' (not yet)'}</span>
              </p>
              <p className="tabular text-[12px] text-ink-3">
                {step.at ? formatDateTime(step.at) : 'Not yet'}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const SLA_TONES: Record<string, { box: string; badge: 'danger' | 'warning' | 'success' }> = {
  BREACHED: { box: 'bg-st-late-bg text-st-late', badge: 'danger' },
  WARNING: { box: 'bg-st-review-bg text-st-review', badge: 'warning' },
};
const SLA_ON_TRACK = { box: 'bg-st-done-bg text-st-done', badge: 'success' } as const;

/** Rework as a reader would say it: minutes, hours, or days. */
function formatRework(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

/** `ON_TRACK` → `On track`. */
function humanise(code: string): string {
  const words = code.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const { created } = await searchParams;

  // getCase throws NotFoundError for a case that does not exist *or* lies
  // outside the caller's scope — the two are deliberately indistinguishable.
  // Rendering Next's not-found page keeps that promise at the HTTP layer too,
  // instead of surfacing an uncaught error as a 500.
  const record = await getCase(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const snapshot = {
    id: record.id,
    caseNumber: record.caseNumber,
    status: record.status as CaseStatus,
    version: record.version,
    discipline: record.discipline as 'CIVIL' | 'MECHANICAL',
    finalValue: record.finalValue?.toString() ?? null,
    requestingOrgId: record.requestingOrgId,
    departmentId: record.departmentId,
    requestedById: record.requestedById,
    makerId: record.makerId,
    checkerId: record.checkerId,
  };

  const available = actionsFor(actor, snapshot);

  const actions: ActionSpec[] = available
    .filter((action): action is WorkflowAction => action in ACTION_PRESENTATION)
    .map((action) => ({ action, ...ACTION_PRESENTATION[action]! }));

  // Only load candidate valuators when an assignment is actually on offer.
  const needsAssignees = actions.some((a) => a.requiresAssignee);
  const isCheckerStep = available.includes('ASSIGN_CHECKER');

  const assignees: AssigneeOption[] = needsAssignees
    ? await listAssignableValuators(actor, {
        departmentId: record.departmentId,
        discipline: record.discipline as 'CIVIL' | 'MECHANICAL',
        forRole: isCheckerStep ? 'CHECKER' : 'MAKER',
        // Segregation of duties: the maker is never offered as the checker.
        excludeUserId: isCheckerStep ? record.makerId : null,
      })
    : [];

  const discipline = record.discipline as 'CIVIL' | 'MECHANICAL';
  const [documents, categories, missing, valuation] = await Promise.all([
    listDocuments(actor, record.id),
    listDocumentCategories(discipline),
    missingMandatoryCategories(record.id, discipline),
    loadValuationSummary(actor, record.id),
  ]);
  const [openComments, approvalRecord, caseDocuments, siteVisits] = await Promise.all([
    countOpenComments(record.id),
    loadApprovalRecord(actor, record.id),
    listCaseDocuments(actor, record.id),
    loadSiteVisitEvidence(actor, record.id),
  ]);
  // The visit to show: the latest one proving presence, else the latest of any kind.
  const shownVisit = siteVisits?.onSite
    ? { ...siteVisits.onSite, distanceMeters: null }
    : (siteVisits?.latest ?? null);
  const canReadValuation = canAccessCase(actor, record, PERMISSIONS.VALUATION_READ);
  const canWorkValuation = canAccessCase(actor, record, PERMISSIONS.VALUATION_EDIT);

  const caseIsOpen = !['APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED'].includes(record.status);

  const openCorrection = record.corrections.find((c) => c.resolvedAt === null);

  const DisciplineIcon = discipline === 'CIVIL' ? Building2 : Cog;
  const sla = record.slaRecord ? (SLA_TONES[record.slaRecord.status] ?? SLA_ON_TRACK) : null;

  return (
    <div className="space-y-6">
      <header className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden="true"
          className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-(--radius-card) bg-nib-gold-500/15 text-nib-gold-700 sm:flex dark:text-nib-gold-400"
        >
          <DisciplineIcon className="h-7 w-7" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-nib-gold-600 dark:text-nib-gold-400">
            {record.requestType.name} · {record.requestingOrg.name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-[26px]">
              {record.caseNumber}
            </h1>
            <StatusBadge status={record.status as CaseStatus} />
            <Badge variant="brand">{discipline === 'CIVIL' ? 'Civil' : 'Mechanical'}</Badge>
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <UserSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Owner:</span>
              {record.ownerName}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <User className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Applicant:</span>
              {record.applicantName}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
              Raised {formatDateTime(record.createdAt)}
            </span>
          </p>
        </div>
      </header>

      {created === '1' ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertTitle>Request created</AlertTitle>
          <AlertDescription>
            The case is a draft and is not yet visible to the valuation department. Submit it when
            the supporting documents are attached.
          </AlertDescription>
        </Alert>
      ) : null}

      {openCorrection ? (
        <Alert variant="destructive">
          <Undo2 aria-hidden="true" />
          <AlertTitle>
            Correction #{openCorrection.sequence} — returned by {openCorrection.returnedBy.fullName}
          </AlertTitle>
          <AlertDescription>
            <p className="mb-1">{openCorrection.comment}</p>
            <p className="text-[11px]">
              Returned {formatDateTime(openCorrection.returnedAt)} from{' '}
              {openCorrection.previousStatus}.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-3">
                <CardIcon icon={ClipboardList} />
                Case details
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <dl className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
                <Detail icon={User} label="Applicant">
                  {record.applicantName}
                  {record.applicantPhone ? (
                    <DetailNote icon={Phone}>{record.applicantPhone}</DetailNote>
                  ) : null}
                </Detail>
                <Detail icon={UserSquare} label="Owner">
                  {record.ownerName}
                  {record.ownerPhone ? (
                    <DetailNote icon={Phone}>{record.ownerPhone}</DetailNote>
                  ) : null}
                </Detail>
                <Detail icon={Building} label="Requesting unit">
                  {record.requestingOrg.name}
                </Detail>
                <Detail icon={UserPen} label="Raised by">
                  {record.requestedBy.fullName}
                  <DetailNote>{record.requestedBy.employeeId}</DetailNote>
                </Detail>
                <Detail icon={HardHat} label="Maker">
                  {record.maker?.fullName ?? (
                    <span className="font-normal text-ink-3">Unassigned</span>
                  )}
                </Detail>
                <Detail icon={ShieldCheck} label="Checker">
                  {record.checker?.fullName ?? (
                    <span className="font-normal text-ink-3">Unassigned</span>
                  )}
                </Detail>
                <Detail icon={Landmark} label="Department">
                  {record.department.name}
                </Detail>
                <Detail icon={Wallet} label="Final value">
                  {record.finalValue ? (
                    <span className="tabular font-semibold">
                      {formatCurrency(record.finalValue.toString(), record.currency)}
                    </span>
                  ) : (
                    <span className="font-normal text-ink-3">Not yet valued</span>
                  )}
                </Detail>
                <Detail icon={Link2} label="Prior case">
                  {record.priorCase ? (
                    <Link
                      href={`/requests/${record.priorCase.id}`}
                      className="text-nib-gold-700 hover:underline dark:text-nib-gold-400"
                    >
                      {record.priorCase.caseNumber}
                    </Link>
                  ) : (
                    <span className="font-normal text-ink-3">None</span>
                  )}
                </Detail>
                {record.purpose ? (
                  <Narrative icon={Target} label="Purpose">
                    {record.purpose}
                  </Narrative>
                ) : null}
                {record.remarks ? (
                  <Narrative icon={MessageSquareText} label="Remarks">
                    {record.remarks}
                  </Narrative>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-3">
                <CardIcon icon={Paperclip} />
                Supporting documents
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <DocumentPanel
                caseId={record.id}
                documents={documents.map((d) => ({
                  id: d.id,
                  filename: d.originalFilename,
                  categoryName: d.category.name,
                  categoryCode: d.category.code,
                  isMandatory: d.category.isMandatory,
                  sizeBytes: d.sizeBytes,
                  version: d.version,
                  scanStatus: d.scanStatus,
                  uploadedBy: d.uploadedBy.fullName,
                  uploadedAt: d.uploadedAt.toISOString(),
                }))}
                categories={categories}
                missing={missing.map((m) => ({ code: m.code, name: m.name }))}
                canUpload={caseIsOpen && actor.permissions.has(PERMISSIONS.DOCUMENT_UPLOAD)}
                canDelete={caseIsOpen && actor.permissions.has(PERMISSIONS.DOCUMENT_DELETE)}
              />
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-3">
                <CardIcon icon={History} />
                Timeline
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <CaseTimeline
                entries={record.history.map((entry) => ({
                  id: entry.id,
                  fromStatus: entry.fromStatus as CaseStatus | null,
                  toStatus: entry.toStatus as CaseStatus,
                  action: entry.action,
                  actorName: entry.actor.fullName,
                  actorRole: entry.actorRole,
                  comment: entry.comment,
                  occurredAt: entry.occurredAt.toISOString(),
                  durationSeconds: entry.durationSeconds,
                }))}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-3">
                <CardIcon icon={Zap} />
                Actions
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <WorkflowActions
                caseId={record.id}
                version={record.version}
                actions={actions}
                assignees={assignees}
              />
            </CardContent>
          </Card>

          {canReadValuation ? (
            <Card className="overflow-hidden">
              <CardBar>
                <CardTitle className="flex items-center gap-3">
                  <CardIcon icon={Calculator} />
                  Valuation
                </CardTitle>
              </CardBar>
              <CardContent className="space-y-4 pt-6">
                {valuation?.marketValue ? (
                  <div className="space-y-3">
                    <div className="rounded-(--radius-control) bg-nib-gold-500/12 p-4">
                      <p className="text-[12px] font-medium text-ink-2">Market value</p>
                      <p className="tabular text-[22px] font-bold leading-tight text-nib-gold-800 dark:text-nib-gold-400">
                        {formatCurrency(valuation.marketValue)}
                      </p>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 text-[13px]">
                      <span className="text-ink-3">Forced-sale value</span>
                      <span className="tabular font-semibold text-ink">
                        {valuation.forcedSaleValue
                          ? formatCurrency(valuation.forcedSaleValue)
                          : '—'}
                      </span>
                    </div>
                    {valuation.calculatedAt ? (
                      <p className="text-[12px] text-ink-3">
                        Version {valuation.version} · {valuation.calculatedBy},{' '}
                        {formatDateTime(valuation.calculatedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : valuation?.stale ? (
                  <p className="rounded-(--radius-control) bg-st-review-bg p-3.5 text-[12.5px] text-ink-2">
                    The property changed after the last calculation, so its figures were cleared.
                    Recalculate before submitting for checking.
                  </p>
                ) : (
                  <p className="text-[12.5px] text-ink-3">
                    Not calculated yet. The assigned valuator records the property and calculates
                    the value in the valuation workspace.
                  </p>
                )}
                {siteVisits ? (
                  <Link
                    href={`/requests/${record.id}/valuation#visits`}
                    className="block space-y-1 rounded-(--radius-control) bg-surface-2 px-3.5 py-2.5 transition-colors hover:bg-surface-3"
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                      <span className="font-semibold text-ink">Site visit</span>
                      {shownVisit ? (
                        <SiteVisitCheckBadge
                          check={shownVisit.check}
                          distanceMeters={shownVisit.distanceMeters}
                        />
                      ) : (
                        <span className="text-ink-3">None recorded</span>
                      )}
                    </span>
                    {shownVisit ? (
                      <span className="block text-[11.5px] text-ink-3">
                        {shownVisit.visitedBy}, {formatDateTime(shownVisit.visitedAt)}
                        {siteVisits.total > 1 ? ` · ${siteVisits.total} visits` : ''}
                      </span>
                    ) : null}
                  </Link>
                ) : null}
                {openComments > 0 ? (
                  <Link
                    href={`/requests/${record.id}/valuation#review`}
                    className="flex items-center gap-2.5 rounded-(--radius-control) bg-st-review-bg px-3.5 py-2.5 text-[12.5px] font-semibold text-ink transition-colors hover:bg-st-review/15"
                  >
                    <MessagesSquare className="h-4 w-4 text-st-review" aria-hidden="true" />
                    {openComments} open review comment{openComments === 1 ? '' : 's'}
                  </Link>
                ) : null}
                <Link
                  href={`/requests/${record.id}/valuation`}
                  className={buttonVariants({
                    variant: canWorkValuation ? 'default' : 'outline',
                    className: 'w-full',
                  })}
                >
                  <Calculator aria-hidden="true" />
                  {canWorkValuation ? 'Open valuation workspace' : 'View valuation'}
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <CardBar>
              <CardTitle className="flex items-center gap-3">
                <CardIcon icon={Route} />
                Progress
              </CardTitle>
            </CardBar>
            <CardContent className="pt-6">
              <ProgressSteps
                steps={[
                  { label: 'Raised', at: record.createdAt, icon: FilePlus2 },
                  { label: 'Submitted', at: record.requestedAt, icon: Send },
                  { label: 'Assigned', at: record.assignedAt, icon: UserPlus },
                  { label: 'Checked', at: record.checkedAt, icon: ClipboardCheck },
                  { label: 'Approved', at: record.approvedAt, icon: Stamp },
                  { label: 'Completed', at: record.completedAt, icon: BadgeCheck },
                ]}
              />
              {record.slaRecord && sla ? (
                <div
                  className={cn(
                    'mt-5 flex items-center gap-3 rounded-(--radius-control) p-3.5',
                    sla.box,
                  )}
                >
                  <Timer className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] text-ink-2">Turnaround due</p>
                    <p className="tabular text-[13px] font-semibold text-ink">
                      {formatDateTime(record.slaRecord.dueAt)}
                    </p>
                  </div>
                  <Badge size="sm" variant={sla.badge}>
                    {humanise(record.slaRecord.status)}
                  </Badge>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {approvalRecord && (approvalRecord.approvals.length > 0 || approvalRecord.signature) ? (
            <ApprovalRecordCard
              approvals={approvalRecord.approvals}
              signature={approvalRecord.signature}
            />
          ) : null}

          {caseDocuments.length > 0 ? (
            <DocumentsCard caseId={record.id} documents={caseDocuments} />
          ) : null}

          {record.corrections.length > 0 ? (
            <Card className="overflow-hidden">
              <CardBar>
                <CardTitle className="flex items-center gap-3">
                  <CardIcon icon={Undo2} tone="danger" />
                  Correction history
                </CardTitle>
              </CardBar>
              <CardContent className="space-y-4 pt-6">
                {record.corrections.map((cycle) => (
                  <div
                    key={cycle.id}
                    className="rounded-(--radius-control) border border-line border-l-[3px] border-l-st-late/60 bg-surface-2/40 p-3.5"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-ink">
                      Correction #{cycle.sequence}
                      {cycle.resolvedAt ? (
                        <Badge variant="success" size="sm">
                          Resolved
                        </Badge>
                      ) : (
                        <Badge variant="danger" size="sm">
                          Open
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {cycle.returnedBy.fullName} · {formatDateTime(cycle.returnedAt)}
                    </p>
                    <p className="mt-1 text-[12px] wrap-anywhere">{cycle.comment}</p>
                    {Array.isArray(cycle.flaggedSections) && cycle.flaggedSections.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {(cycle.flaggedSections as string[]).map((section) => (
                          <Badge key={section} size="sm" variant="accent">
                            {REVIEW_SECTION_LABELS[section as ReviewSection] ?? section}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {cycle.resolvedAt ? (
                      <p className="mt-2 text-[11.5px] text-ink-3">
                        Resubmitted {formatDateTime(cycle.resolvedAt)}
                        {cycle.reworkSeconds !== null
                          ? ` · rework took ${formatRework(cycle.reworkSeconds)}`
                          : ''}
                        {cycle.resolutionNote ? (
                          <span className="mt-0.5 block text-ink-2 wrap-anywhere">
                            Corrected: {cycle.resolutionNote}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
