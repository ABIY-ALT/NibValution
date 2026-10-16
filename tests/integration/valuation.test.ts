import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTransaction } from '@/server/infrastructure/db/client';
import { createCase, performTransition } from '@/server/application/case-service';
import { loadValuationCard, recordValuation } from '@/server/application/valuation-service';
import { verifyCurrentValuation } from '@/server/application/valuation-state';
import { loadApprovalRecord } from '@/server/application/signature-service';
import { listCaseDocuments, loadCaseDocument } from '@/server/application/case-document-service';
import { resolveFinalLetterAuthority } from '@/server/domain/approval/routing';
import { loadFinalLetterRules } from '@/server/application/configuration-service';
import { valuationFiguresSchema, type ValuationFiguresInput } from '@/lib/validation/valuation';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { RoleCode } from '@/server/domain/shared/enums';
import { BusinessRuleError, ForbiddenError, NotFoundError, WorkflowError } from '@/lib/errors';

/**
 * The valuation module end to end against the real database (roadmap Phase 3):
 * a civil case is assigned and started and its figures entered by the
 * valuator; the figures and the record of their entry are persisted together;
 * the submit-for-checking guard checks the case against that entry and refuses
 * a tampered or out-of-date figure.
 */

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;

const SUFFIX = `val-${Date.now()}`;
const CTX = { ipAddress: '10.0.0.9', userAgent: 'vitest', correlationId: SUFFIX };

const created = { userIds: [] as string[], caseIds: [] as string[], orgId: '' };

async function makeActor(
  label: string,
  roles: RoleCode[],
  opts: { organizationId?: string; departmentId?: string; discipline?: 'CIVIL' | 'BOTH' } = {},
): Promise<Actor> {
  const user = await prisma.user.create({
    data: {
      employeeId: `VAL-${SUFFIX}-${label}`.toUpperCase(),
      email: `${label}.${SUFFIX}@test.invalid`,
      fullName: `VAL ${label}`,
      organizationId: opts.organizationId ?? null,
      departmentId: opts.departmentId ?? null,
      discipline: opts.discipline ?? 'CIVIL',
    },
  });
  created.userIds.push(user.id);

  const permissions = new Set<PermissionCode>();
  for (const roleCode of roles) {
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: roleCode },
      include: { permissions: { include: { permission: true } } },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    for (const grant of role.permissions) permissions.add(grant.permission.code as PermissionCode);
  }

  return {
    id: user.id,
    fullName: user.fullName,
    roles,
    permissions,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    discipline: user.discipline,
    isActive: true,
    organizationScope: user.organizationId ? [user.organizationId] : [],
  };
}

describeIfDb('valuation module', () => {
  let owner: Actor;
  let manager: Actor;
  let maker: Actor;
  let checker: Actor;
  let checkerManager: Actor;
  let director: Actor;

  let caseId = '';

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { code: `VALORG-${SUFFIX}`, name: 'Valuation Test Branch', type: 'BRANCH' },
    });
    created.orgId = org.id;
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: 'PVD' } });

    owner = await makeActor('owner', ['PROCESS_OWNER'], { organizationId: org.id });
    manager = await makeActor('mgr', ['MAKER_MANAGER'], {
      departmentId: dept.id,
      discipline: 'BOTH',
    });
    maker = await makeActor('maker', ['MAKER'], { departmentId: dept.id });
    checker = await makeActor('checker', ['CHECKER'], { departmentId: dept.id });
    checkerManager = await makeActor('cmgr', ['CHECKER_MANAGER'], {
      departmentId: dept.id,
      discipline: 'BOTH',
    });
    director = await makeActor('dir', ['DIRECTOR'], { departmentId: dept.id, discipline: 'BOTH' });

    const intake = await createCase(
      owner,
      {
        requestTypeCode: 'NEW',
        discipline: 'CIVIL',
        applicantName: 'Applicant',
        ownerName: 'Owner',
      },
      CTX,
    );
    caseId = intake.id;
    created.caseIds.push(caseId);

    // The documents a civil case requires, so the submission tests exercise the
    // valuation guard rather than the document guard.
    const categories = await prisma.documentCategory.findMany({
      where: {
        isMandatory: true,
        isActive: true,
        OR: [{ discipline: null }, { discipline: 'CIVIL' }],
      },
      select: { id: true, code: true },
    });
    for (const category of categories) {
      await prisma.propertyDocument.create({
        data: {
          caseId,
          categoryId: category.id,
          originalFilename: `${category.code}.pdf`,
          storageKey: `test/${caseId}/${category.code}-${Math.random().toString(36).slice(2)}`,
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256: 'a'.repeat(64),
          scanStatus: 'CLEAN',
          uploadedById: owner.id,
        },
      });
    }

    await transition(owner, 'SUBMIT_REQUEST');
    await transition(manager, 'ASSIGN_MAKER', { assigneeId: maker.id });
    await transition(maker, 'START_VALUATION');
  });

  afterAll(async () => {
    // The fixture removes rows the application is designed never to remove.
    // Each protection is lifted explicitly and restored in the finally block -
    // which is itself the clearest evidence that they are real.
    const guards: [table: string, trigger: string][] = [
      ['calculation_runs', 'calculation_runs_append_only'],
      ['valuation_cases', 'valuation_cases_delete_guard'],
      ['workflow_history', 'workflow_history_append_only'],
      ['correction_cycles', 'correction_cycles_close_only'],
      ['approvals', 'approvals_append_only'],
      ['reports', 'reports_immutable_when_final'],
      ['digital_signatures', 'digital_signatures_revoke_only'],
      ['valuations', 'valuations_frozen_immutable'],
    ];
    for (const [table, trigger] of guards) {
      await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
    }
    try {
      const caseIds = { in: created.caseIds };
      // Replies first: a thread's parent is protected while replies point at it.
      await prisma.comment.deleteMany({ where: { caseId: caseIds, parentId: { not: null } } });
      await prisma.comment.deleteMany({ where: { caseId: caseIds } });
      await prisma.digitalSignature.deleteMany({ where: { caseId: caseIds } });
      await prisma.report.deleteMany({ where: { caseId: caseIds } });
      await prisma.calculationRun.deleteMany({ where: { valuation: { caseId: caseIds } } });
      await prisma.propertyDocument.deleteMany({ where: { caseId: caseIds } });
      await prisma.valuationCase.deleteMany({ where: { id: caseIds } });
      await prisma.userRole.deleteMany({ where: { userId: { in: created.userIds } } });
      await prisma.user.updateMany({
        where: { id: { in: created.userIds } },
        data: { organizationId: null, isActive: false },
      });
      if (created.orgId) await prisma.organization.deleteMany({ where: { id: created.orgId } });
    } finally {
      for (const [table, trigger] of guards) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
      }
      await prisma.$disconnect();
    }
  });

  async function transition(
    actor: Actor,
    action: string,
    extra: { assigneeId?: string; comment?: string } = {},
  ) {
    const { version } = await prisma.valuationCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { version: true },
    });
    await performTransition(
      actor,
      {
        caseId,
        action: action as never,
        expectedVersion: version,
        assigneeId: extra.assigneeId ?? null,
        comment: extra.comment ?? null,
      },
      CTX,
    );
  }

  const statusOf = async () =>
    (await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } })).status;

  /**
   * The maker's figures, written as a valuator types them. `market` and
   * `forced` stand for any figures the maker changes between entries.
   */
  function request(market = '6,500,000', forced = '4,875,000'): ValuationFiguresInput {
    return valuationFiguresSchema.parse({
      caseId,
      valuationDate: '2026-09-01',
      marketValue: market,
      forcedSaleValue: forced,
      remarks: 'Integration test valuation',
    });
  }

  const verified = () => withTransaction((tx) => verifyCurrentValuation(tx, caseId));

  it('refuses submission for checking before any figures are entered', async () => {
    await expect(transition(maker, 'SUBMIT_FOR_CHECKING')).rejects.toThrow(
      /figures are not complete/,
    );
  });

  it('refuses an entry by anyone but the assigned maker', async () => {
    await expect(recordValuation(checker, request(), CTX)).rejects.toSatisfy(
      (error) => error instanceof ForbiddenError || error instanceof NotFoundError,
    );
  });

  it('records the figures as entered, with the record of their entry', async () => {
    const result = await recordValuation(maker, request(), CTX);
    expect(result).toEqual({
      marketValue: '6500000.00',
      forcedSaleValue: '4875000.00',
      version: 1,
    });

    const valuation = await prisma.valuation.findFirstOrThrow({
      where: { caseId, isCurrent: true },
      include: {
        costApproach: true,
        reconciliation: true,
        forcedSale: true,
        calculationRuns: true,
      },
    });
    expect(valuation.marketValue?.toFixed(2)).toBe('6500000.00');
    expect(valuation.forcedSaleValue?.toFixed(2)).toBe('4875000.00');
    expect(valuation.formulaVersion).toBe('manual-1.0.0');
    expect(valuation.remarks).toBe('Integration test valuation');
    // Nothing is calculated: no parameters priced the figures, and there is no working.
    expect(valuation.parameterSetId).toBeNull();
    expect(valuation.costApproach).toBeNull();
    expect(valuation.reconciliation).toBeNull();
    expect(valuation.forcedSale).toBeNull();

    expect(valuation.calculationRuns).toHaveLength(1);
    const run = valuation.calculationRuns[0];
    expect(run?.engine).toBe('CIVIL');
    expect(run?.formulaVersion).toBe('manual-1.0.0');
    expect(run?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run?.outputSnapshot).toEqual({
      formulaVersion: 'manual-1.0.0',
      marketValue: '6500000.00',
      forcedSaleValue: '4875000.00',
      forcedSalePercent: '75.00',
    });

    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(theCase.finalValue?.toFixed(2)).toBe('6500000.00');
    expect(theCase.forcedSaleValue?.toFixed(2)).toBe('4875000.00');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Valuation', entityId: valuation.id, action: 'CALCULATION_PERFORMED' },
    });
    expect(audit).not.toBeNull();
  });

  it('verifies the figures against the stored entry', async () => {
    expect(await verified()).toBe(true);
  });

  it('refuses a stored figure that no longer matches its entry', async () => {
    const valuation = await prisma.valuation.findFirstOrThrow({
      where: { caseId, isCurrent: true },
    });
    const original = valuation.marketValue?.toString() ?? '0';
    await prisma.valuation.update({ where: { id: valuation.id }, data: { marketValue: '1.00' } });
    try {
      expect(await verified()).toBe(false);
    } finally {
      await prisma.valuation.update({
        where: { id: valuation.id },
        data: { marketValue: original },
      });
    }
    expect(await verified()).toBe(true);
  });

  it('offers the figures, from the last entry, to the assigned valuator only', async () => {
    const forMaker = await loadValuationCard(maker, caseId);
    expect(forMaker?.canEnterFigures).toBe(true);
    // The form starts from the last entry, as typed.
    expect(forMaker?.figures).toEqual({
      valuationDate: '2026-09-01',
      marketValue: '6500000',
      forcedSaleValue: '4875000',
      remarks: 'Integration test valuation',
    });
    expect(forMaker?.summary?.marketValue).toBe('6500000');

    const forManager = await loadValuationCard(manager, caseId);
    expect(forManager?.canEnterFigures).toBe(false);
    expect(forManager?.summary?.marketValue).toBe('6500000');
  });

  it('refuses figures that are not amounts, or a forced-sale value above the market value', () => {
    const figures = (marketValue: string, forcedSaleValue: string) =>
      valuationFiguresSchema.safeParse({
        caseId,
        valuationDate: '2026-09-01',
        marketValue,
        forcedSaleValue,
        remarks: '',
      });
    const failed = (parsed: ReturnType<typeof figures>) =>
      parsed.error?.issues.map((issue) => issue.path.join('.')) ?? [];

    expect(failed(figures('100', '150'))).toEqual(['forcedSaleValue']);
    expect(failed(figures('abc', '150'))).toEqual(['marketValue']);
    expect(failed(figures('0', '0'))).toEqual(['marketValue', 'forcedSaleValue']);
    expect(failed(figures('100.555', '50'))).toEqual(['marketValue']);
    expect(figures('100', '100').success).toBe(true);
  });

  it('lets the case move on to checking once its figures are entered, and then freezes them', async () => {
    await transition(maker, 'SUBMIT_FOR_CHECKING');
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(theCase.status).toBe('SUBMITTED_FOR_CHECKING');

    await expect(recordValuation(maker, request('7,000,000'), CTX)).rejects.toThrow(
      /On Progress or Returned for Correction/,
    );
    expect((await loadValuationCard(maker, caseId))?.canEnterFigures).toBe(false);
  });

  it('keeps a stale workflow error distinct from the valuation guard', async () => {
    // Submitting again from the wrong status is a workflow refusal, not a
    // valuation one - the two failures must stay distinguishable.
    await expect(transition(maker, 'SUBMIT_FOR_CHECKING')).rejects.toBeInstanceOf(WorkflowError);
  });

  // -------------------------------------------------------------------------
  // Checking (roadmap Phase 4): review comments and the correction round trip
  // -------------------------------------------------------------------------

  const currentValuation = () =>
    prisma.valuation.findFirstOrThrow({ where: { caseId, isCurrent: true } });
  const openTask = (taskType: 'PERFORM_CHECKING' | 'CORRECT_VALUATION') =>
    prisma.workflowTask.findFirst({ where: { caseId, taskType, completedAt: null } });

  it('assigns a checker, who takes over the valuation for review', async () => {
    await transition(checkerManager, 'ASSIGN_CHECKER', { assigneeId: checker.id });
    expect(await statusOf()).toBe('CHECKING');
    expect((await currentValuation()).status).toBe('UNDER_CHECK');
    expect((await openTask('PERFORM_CHECKING'))?.assigneeId).toBe(checker.id);
  });

  it('refuses a return for correction without a comment', async () => {
    await expect(transition(checker, 'RETURN_FOR_CORRECTION')).rejects.toThrow(BusinessRuleError);
    expect(await statusOf()).toBe('CHECKING');
  });

  it('returns for correction with the checker’s comment, ending the review task', async () => {
    await transition(checker, 'RETURN_FOR_CORRECTION', {
      comment: 'The land rate is above the recent Bole sales; please revise the figures.',
    });
    expect(await statusOf()).toBe('RETURNED_FOR_CORRECTION');

    const cycle = await prisma.correctionCycle.findFirstOrThrow({ where: { caseId } });
    expect(cycle.resolvedAt).toBeNull();

    expect(await openTask('PERFORM_CHECKING')).toBeNull();
    expect((await openTask('CORRECT_VALUATION'))?.assigneeId).toBe(maker.id);
    expect((await currentValuation()).status).toBe('DRAFT');
  });

  it('lets the maker re-enter the figures while the case is returned', async () => {
    expect((await loadValuationCard(maker, caseId))?.canEnterFigures).toBe(true);
    const result = await recordValuation(maker, request('6,200,000', '4,650,000'), CTX);
    expect(result).toEqual({
      marketValue: '6200000.00',
      forcedSaleValue: '4650000.00',
      version: 1,
    });
    expect(await verified()).toBe(true);
  });

  it('requires a note of what was corrected before resubmission', async () => {
    await expect(transition(maker, 'RESUBMIT')).rejects.toThrow(BusinessRuleError);
  });

  it('resubmits to the same checker and closes the correction cycle with its rework time', async () => {
    await transition(maker, 'RESUBMIT', {
      comment: 'Land rate revised against the recent Bole sales.',
    });
    expect(await statusOf()).toBe('CHECKING');

    const cycle = await prisma.correctionCycle.findFirstOrThrow({ where: { caseId } });
    expect(cycle.resolvedAt).not.toBeNull();
    expect(cycle.resolutionNote).toContain('Land rate revised');
    expect(cycle.reworkSeconds).toBeGreaterThanOrEqual(0);

    // The review task reopens for the same checker.
    expect((await openTask('PERFORM_CHECKING'))?.assigneeId).toBe(checker.id);
    expect((await currentValuation()).status).toBe('UNDER_CHECK');
  });

  it('completes checking, recording the checker', async () => {
    await transition(checker, 'COMPLETE_CHECKING');
    expect(await statusOf()).toBe('CHECKED');

    const valuation = await currentValuation();
    expect(valuation.status).toBe('CHECKED');
    expect(valuation.checkedById).toBe(checker.id);
  });

  // -------------------------------------------------------------------------
  // Approval and signature (roadmap Phase 5)
  // -------------------------------------------------------------------------

  it('routes into approval by the configured band, never to the checker again', async () => {
    await transition(maker, 'SUBMIT_FOR_APPROVAL');
    expect(['PENDING_MANAGER_APPROVAL', 'PENDING_DIRECTOR_APPROVAL', 'APPROVED']).toContain(
      await statusOf(),
    );
  });

  it('refuses an approval from the valuator or the checker of the case', async () => {
    if ((await statusOf()) === 'APPROVED') return;
    await expect(transition(checker, 'APPROVE_MANAGER')).rejects.toThrow();
    await expect(transition(maker, 'APPROVE_MANAGER')).rejects.toThrow();
  });

  it('approves through every gate the band requires, recording each decision on its value', async () => {
    for (let step = 0; step < 3 && (await statusOf()) !== 'APPROVED'; step += 1) {
      const status = await statusOf();
      if (status === 'PENDING_MANAGER_APPROVAL') await transition(manager, 'APPROVE_MANAGER');
      if (status === 'PENDING_DIRECTOR_APPROVAL') await transition(director, 'APPROVE_DIRECTOR');
    }
    expect(await statusOf()).toBe('APPROVED');

    const approvals = await prisma.approval.findMany({
      where: { caseId, decision: 'APPROVED' },
      orderBy: { decidedAt: 'asc' },
    });
    // The checker's completion is the first decision on record.
    expect(approvals[0]?.level).toBe('CHECKER');
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    for (const approval of approvals) {
      expect(approval.valueAtDecision.toFixed(2)).toBe(theCase.finalValue?.toFixed(2));
    }
    expect(theCase.approvalLevel).not.toBeNull();
  });

  it('freezes the approved valuation, so the database refuses to change it', async () => {
    const valuation = await currentValuation();
    expect(valuation.status).toBe('APPROVED');
    expect(valuation.frozenAt).not.toBeNull();
    await expect(
      prisma.valuation.update({ where: { id: valuation.id }, data: { marketValue: '1.00' } }),
    ).rejects.toThrow(/frozen/);
  });

  it('refuses to sign without a fresh password check', async () => {
    await expect(transition(director, 'SIGN')).rejects.toThrow(/Confirm your password/);
    expect(await statusOf()).toBe('APPROVED');
  });

  it('signs the approved valuation as an immutable report whose signature verifies', async () => {
    const { version } = await prisma.valuationCase.findUniqueOrThrow({
      where: { id: caseId },
      select: { version: true },
    });
    await performTransition(
      director,
      { caseId, action: 'SIGN', expectedVersion: version, reauthenticatedWithinWindow: true },
      CTX,
    );
    expect(await statusOf()).toBe('SIGNED');

    const report = await prisma.report.findFirstOrThrow({ where: { caseId, type: 'VALUATION' } });
    expect(report.isImmutable).toBe(true);
    const document = report.dataSnapshot as {
      valuation: { marketValue: string };
      approvals: { level: string }[];
      signer: { id: string };
      siteInspection: unknown[];
      calculation: { output: unknown };
    };
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(document.valuation.marketValue).toBe(theCase.finalValue?.toFixed(2));
    expect(document.approvals[0]?.level).toBe('CHECKER');
    expect(document.signer.id).toBe(director.id);
    // What was signed is the valuator's entry; no site visits are recorded.
    expect(document.calculation.output).toEqual({
      formulaVersion: 'manual-1.0.0',
      marketValue: '6200000.00',
      forcedSaleValue: '4650000.00',
      forcedSalePercent: '75.00',
    });
    expect(document.siteInspection).toEqual([]);

    const record = await loadApprovalRecord(director, caseId);
    expect(record?.signature?.check).toBe('VALID');

    // The signed document cannot be edited afterwards.
    await expect(
      prisma.report.update({ where: { id: report.id }, data: { sha256: 'tampered' } }),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Reports (roadmap Phase 6)
  // -------------------------------------------------------------------------

  it('froze a cover page when the case was submitted for approval', async () => {
    const cover = await prisma.report.findFirstOrThrow({ where: { caseId, type: 'COVER_PAGE' } });
    expect(cover.isImmutable).toBe(true);
    const document = cover.dataSnapshot as { valuation: { marketValue: string } };
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(document.valuation.marketValue).toBe(theCase.finalValue?.toFixed(2));
  });

  it('refuses delivery before the final letter is issued', async () => {
    await expect(transition(manager, 'DELIVER')).rejects.toThrow(/final letter/);
  });

  it('lets only the authority the value resolves to issue the final letter, once', async () => {
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    const authority = resolveFinalLetterAuthority(
      await loadFinalLetterRules(),
      theCase.finalValue!.toString(),
      theCase.requestedAt ?? theCase.createdAt,
    );
    const issuer = authority.issuerRole === 'DIRECTOR' ? director : manager;
    const other = authority.issuerRole === 'DIRECTOR' ? manager : director;

    await expect(transition(other, 'GENERATE_FINAL_LETTER')).rejects.toThrow(/issued by the/);
    await transition(issuer, 'GENERATE_FINAL_LETTER');

    const letter = await prisma.report.findFirstOrThrow({
      where: { caseId, type: 'FINAL_LETTER' },
    });
    const document = letter.dataSnapshot as {
      reference: string;
      schemaVersion: number;
      valuation: { marketValue: string };
      letter: { format: string; statedValue: { amount: string; words: string } | null };
    };
    expect(letter.isImmutable).toBe(true);
    expect(document.reference).toBe(`${theCase.caseNumber}/FL-1`);
    expect(document.valuation.marketValue).toBe(theCase.finalValue?.toFixed(2));
    // A new, completed building: the completed covering letter, stating the value.
    expect(document.schemaVersion).toBe(2);
    expect(document.letter.format).toBe('COMPLETED');
    expect(document.letter.statedValue?.amount).toBe(theCase.finalValue?.toFixed(2));
    expect(document.letter.statedValue?.words).toMatch(/^[A-Z][a-z]+( [A-Z][a-z]+)*$/);

    await expect(transition(issuer, 'GENERATE_FINAL_LETTER')).rejects.toThrow(
      /already been issued/,
    );
  });

  it('keeps the documents from the requester until delivery', async () => {
    expect(await listCaseDocuments(owner, caseId)).toEqual([]);
    const staff = await listCaseDocuments(maker, caseId);
    expect(staff.map((d) => d.type).sort()).toEqual(['COVER_PAGE', 'FINAL_LETTER', 'VALUATION']);
  });

  it('delivers, after which the requester sees the report and the letter but not the working papers', async () => {
    await transition(manager, 'DELIVER');
    expect(await statusOf()).toBe('COMPLETED');

    const seen = await listCaseDocuments(owner, caseId);
    expect(seen.map((d) => d.type).sort()).toEqual(['FINAL_LETTER', 'VALUATION']);

    const cover = await prisma.report.findFirstOrThrow({ where: { caseId, type: 'COVER_PAGE' } });
    await expect(loadCaseDocument(owner, caseId, cover.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('re-renders an issued document from its snapshot, not from today’s case data', async () => {
    const letter = await prisma.report.findFirstOrThrow({
      where: { caseId, type: 'FINAL_LETTER' },
    });
    const before = await loadCaseDocument(owner, caseId, letter.id);

    await prisma.valuationCase.update({
      where: { id: caseId },
      data: { ownerName: 'Renamed Owner' },
    });

    const after = await loadCaseDocument(owner, caseId, letter.id);
    expect(after.intact).toBe(true);
    expect((after.document.case as { owner: string }).owner).toBe(
      (before.document.case as { owner: string }).owner,
    );
    expect((after.document.case as { owner: string }).owner).not.toBe('Renamed Owner');
  });
});
