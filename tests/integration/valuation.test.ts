import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, withTransaction } from '@/server/infrastructure/db/client';
import { createCase, listCases, performTransition } from '@/server/application/case-service';
import { uploadDocument } from '@/server/application/document-service';
import { saveBuilding, saveCivilProperty } from '@/server/application/property-service';
import type { Prisma } from '@prisma/client';
import {
  calculateValuation,
  loadSiteVisitEvidence,
  loadValuationWorkspace,
  recordSiteVisit,
} from '@/server/application/valuation-service';
import { verifyCurrentValuation } from '@/server/application/valuation-state';
import { loadApprovalRecord } from '@/server/application/signature-service';
import { listCaseDocuments, loadCaseDocument } from '@/server/application/case-document-service';
import { resolveFinalLetterAuthority } from '@/server/domain/approval/routing';
import {
  raiseComment,
  replyToComment,
  setCommentResolved,
} from '@/server/application/review-service';
import {
  invalidateConfigurationCache,
  loadFinalLetterRules,
  loadParameterSnapshot,
} from '@/server/application/configuration-service';
import { calculateCivil } from '@/server/domain/valuation/civil-engine';
import {
  calculateRequestSchema,
  siteVisitSchema,
  type CalculateRequest,
} from '@/lib/validation/valuation';
import { buildingSchema, civilPropertySchema } from '@/lib/validation/property';
import type { PermissionCode } from '@/server/domain/rbac/permissions';
import type { Actor } from '@/server/domain/rbac/authorize';
import type { RoleCode } from '@/server/domain/shared/enums';
import { BusinessRuleError, ForbiddenError, NotFoundError, WorkflowError } from '@/lib/errors';

/**
 * The valuation module end to end against the real database (roadmap Phase 3):
 * a civil case is assigned and started, its property registered and valued;
 * the figures, the approach rows and the reproducibility record are persisted
 * together; the submit-for-checking guard re-runs the stored calculation and
 * refuses a tampered or out-of-date figure.
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
  let buildingId = '';

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

    await saveCivilProperty(
      maker,
      civilPropertySchema.parse({
        caseId,
        categoryCode: 'CIV_RESIDENTIAL',
        landHoldingRight: 'FREEHOLD',
        plotArea: '500',
      }),
      CTX,
    );
    await saveBuilding(
      maker,
      buildingSchema.parse({
        caseId,
        buildingNumber: 1,
        buildingType: 'G+2 residence',
        constructionStatus: 'COMPLETED',
        constructionYear: 2011,
        condition: 'GOOD',
        grossArea: '300',
      }),
      CTX,
    );
    const building = await prisma.civilBuilding.findFirstOrThrow({
      where: { property: { caseId } },
      select: { id: true },
    });
    buildingId = building.id;
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

  /** The location ratings of the test property: the best of each, so only the built-up ratio bites. */
  const LOCATION = {
    city: 'Adama',
    purpose: 'RESIDENTIAL',
    propertyType: 'Residential Building',
    floorLevel: '',
    utility: 'Excellent (Available)',
    neighbourhood: 'Excellent (Very Attractive)',
    roadQuality: 'Stable Asphalt',
    roadWidth: 'Access Road Width >= 15m',
    proximity: 'Excellent (Center)',
    accessibility: 'Within 100m',
  };

  /**
   * The maker's worksheet. `fenceArea` stands for any input the maker changes
   * between calculations; `withBuilding` leaves the registered building out.
   */
  function request(fenceArea = '120', withBuilding = true): CalculateRequest {
    return calculateRequestSchema.parse({
      discipline: 'CIVIL',
      caseId,
      worksheet: {
        valuationDate: '2026-09-01',
        location: LOCATION,
        lease: { totalYears: '', totalAmount: '', paidAmount: '', freeholdArea: '' },
        buildings: withBuilding
          ? [
              {
                buildingId,
                costType: '2-5 Storey',
                count: '1',
                heightM: '',
                // Foundation and RC structure, each the whole of its element.
                components: [
                  { row: 11, sharePercent: '100', completionPercent: '' },
                  { row: 13, sharePercent: '100', completionPercent: '' },
                ],
                newComponents: [],
                defects: [{ code: 17, percent: '50' }],
                supplementary: [],
              },
            ]
          : [],
        siteWorks: {
          civil: [
            {
              item: 'HCB Fence Two Sides Pointed (m2)',
              description: 'Boundary fence',
              quantity: fenceArea,
              completionPercent: '',
              pool: null,
            },
          ],
          gasStation: [],
          coffeeSite: [],
        },
        reconciliation: { override: false, costWeight: '75', salesWeight: '25', rationale: '' },
        forcedSale: { override: false, percent: '', reason: '' },
        remarks: 'Integration test valuation',
      },
    });
  }

  const verified = () => withTransaction((tx) => verifyCurrentValuation(tx, caseId));

  it('refuses submission for checking before any calculation', async () => {
    await expect(transition(maker, 'SUBMIT_FOR_CHECKING')).rejects.toThrow(
      /calculation is not complete/,
    );
  });

  it('refuses a calculation by anyone but the assigned maker', async () => {
    await expect(calculateValuation(checker, request(), CTX)).rejects.toSatisfy(
      (error) => error instanceof ForbiddenError || error instanceof NotFoundError,
    );
  });

  it('calculates, and persists the figures with their full working', async () => {
    const result = await calculateValuation(maker, request(), CTX);

    // The same figures the engine gives for the same input and the parameter
    // set in force on the valuation date.
    const snapshot = await loadParameterSnapshot(new Date('2026-09-01T00:00:00Z'));
    const expected = calculateCivil(
      {
        valuationDate: '2026-09-01',
        location: { ...LOCATION, floorLevel: null },
        land: {
          holdingRight: 'FREEHOLD',
          plotArea: '500',
          latitude: null,
          longitude: null,
          leaseRemainingYears: null,
          leaseTotalYears: null,
          leaseTotalAmount: null,
          leasePaidAmount: null,
          freeholdArea: null,
        },
        buildings: [
          {
            buildingId,
            buildingNumber: 1,
            name: 'G+2 residence',
            constructionStatus: 'COMPLETED',
            progressPercent: null,
            floorArea: '300',
            builtUpArea: null,
            costType: '2-5 Storey',
            count: '1',
            heightM: null,
            components: [
              { row: 11, sharePercent: '100', completionPercent: null },
              { row: 13, sharePercent: '100', completionPercent: null },
            ],
            newComponents: [],
            defects: [{ code: 17, percent: '50' }],
            supplementary: [],
          },
        ],
        siteWorks: {
          civil: [
            {
              item: 'HCB Fence Two Sides Pointed (m2)',
              description: 'Boundary fence',
              quantity: '120',
              completionPercent: null,
              pool: null,
            },
          ],
          gasStation: [],
          coffeeSite: [],
        },
        reconciliation: null,
        forcedSale: null,
      },
      snapshot,
    );
    // Adama, residential, 500 m² with no coordinates: 12,000 x 1.25, the
    // first 200 m² in full and the rest at 0.9, x 0.75 for a built-up area
    // that is not recorded.
    expect(expected.land.maxRate.value).toBe('15000.0000');
    expect(expected.land.tiers.averageRate).toBe('14100.0000');
    expect(expected.land.locationValue).toBe('5287500.00');
    // 1,945.925 per m² of fence.
    expect(expected.siteWorks.civilTotal).toBe('233511.00');
    expect(result.marketValue).toBe(expected.marketValue);
    expect(result.forcedSaleValue).toBe(expected.forcedSaleValue);
    expect(result.version).toBe(1);

    const valuation = await prisma.valuation.findFirstOrThrow({
      where: { caseId, isCurrent: true },
      include: {
        costApproach: { include: { lineItems: true, depreciations: true } },
        reconciliation: true,
        forcedSale: true,
        calculationRuns: true,
      },
    });
    expect(valuation.marketValue?.toFixed(2)).toBe(expected.marketValue);
    expect(valuation.parameterSetId).toBe(snapshot.setId);
    // Land, one building, one plot civil work - each with its own formula.
    expect(valuation.costApproach?.lineItems).toHaveLength(3);
    expect(valuation.costApproach?.landValue?.toFixed(2)).toBe(expected.land.value);
    expect(valuation.costApproach?.factor?.toFixed(6)).toBe(expected.cost.factor);
    // Depreciation is by recorded defects, carried on the building's line.
    expect(valuation.costApproach?.depreciations).toHaveLength(0);
    expect(valuation.costApproach?.totalDepreciation?.toFixed(2)).toBe(
      expected.cost.totalDepreciation,
    );
    expect(valuation.reconciliation?.reconciledValue.toFixed(2)).toBe(expected.marketValue);
    expect(valuation.forcedSale?.forcedSaleValue.toFixed(2)).toBe(expected.forcedSaleValue);
    expect(valuation.calculationRuns).toHaveLength(1);
    expect(valuation.calculationRuns[0]?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(valuation.calculationRuns[0]?.formulaVersion).toBe('civil-2.0.0');
    // The run keeps the part of the guideline it read: one city, no zones.
    const kept = valuation.calculationRuns[0]?.parameterSnapshot as {
      tables: Record<string, { cities?: Record<string, unknown>; polygons?: unknown[] }>;
    };
    expect(Object.keys(kept.tables['guideline.cities']?.cities ?? {})).toEqual(['Adama']);
    expect(kept.tables['guideline.location_polygons']?.polygons).toEqual([]);

    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(theCase.finalValue?.toFixed(2)).toBe(expected.marketValue);

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'Valuation', entityId: valuation.id, action: 'CALCULATION_PERFORMED' },
    });
    expect(audit).not.toBeNull();
  });

  it('verifies the stored calculation by re-running it', async () => {
    expect(await verified()).toBe(true);
  });

  it('refuses a stored figure that no longer matches its calculation', async () => {
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

  it('clears the figures when the property changes, until recalculated', async () => {
    await saveCivilProperty(
      maker,
      civilPropertySchema.parse({
        caseId,
        categoryCode: 'CIV_RESIDENTIAL',
        landHoldingRight: 'FREEHOLD',
        plotArea: '520',
      }),
      CTX,
    );
    expect(await verified()).toBe(false);
    const cleared = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(cleared.finalValue).toBeNull();

    const workspace = await loadValuationWorkspace(maker, caseId);
    expect(workspace.canRead && workspace.summary?.stale).toBe(true);

    const again = await calculateValuation(maker, request(), CTX);
    // Still version 1: a draft is recalculated in place, and each run is kept.
    expect(again.version).toBe(1);
    expect(await verified()).toBe(true);
    const runs = await prisma.calculationRun.count({ where: { valuation: { caseId } } });
    expect(runs).toBe(2);
  });

  it('rejects a worksheet that leaves a registered building unvalued', async () => {
    await expect(calculateValuation(maker, request('120', false), CTX)).rejects.toThrow(
      BusinessRuleError,
    );
  });

  /** Runs `fn` with the site-visit rule switched on, restoring the setting after. */
  async function withSiteVisitRule<T>(fn: () => Promise<T>): Promise<T> {
    const key = 'site_visit.require_on_site';
    const previous = await prisma.systemConfiguration.findUnique({ where: { key } });
    await prisma.systemConfiguration.upsert({
      where: { key },
      update: { value: 1 },
      create: { key, value: 1, valueType: 'number' },
    });
    invalidateConfigurationCache();
    try {
      return await fn();
    } finally {
      if (previous) {
        await prisma.systemConfiguration.update({
          where: { key },
          data: { value: previous.value as Prisma.InputJsonValue },
        });
      } else {
        await prisma.systemConfiguration.delete({ where: { key } });
      }
      invalidateConfigurationCache();
    }
  }

  const checkIn = (fields: Record<string, string>) =>
    recordSiteVisit(
      maker,
      siteVisitSchema.parse({ caseId, accessGained: 'yes', findings: '', remarks: '', ...fields }),
      CTX,
    );
  const latestVisit = () =>
    prisma.siteVisit.findFirstOrThrow({ where: { caseId }, orderBy: { createdAt: 'desc' } });

  it('with the site-visit rule on, refuses checking without a visit at the property', async () => {
    await withSiteVisitRule(async () => {
      await expect(transition(maker, 'SUBMIT_FOR_CHECKING')).rejects.toThrow(/site visit/);
      // A visit with no position and no explanation does not satisfy it.
      await checkIn({});
      await expect(transition(maker, 'SUBMIT_FOR_CHECKING')).rejects.toThrow(/site visit/);
    });
    expect(await statusOf()).toBe('ON_PROGRESS');
  });

  it('judges each check-in against the property, at the server’s time', async () => {
    // The property has no coordinates, so a precise check-in becomes its location.
    const before = Date.now();
    await checkIn({ latitude: '9.0100000', longitude: '38.7600000', accuracyMeters: '12' });
    const first = await latestVisit();
    expect(first.locationCheck).toBe('LOCATION_SET');
    expect(first.visitedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const property = await prisma.civilProperty.findUniqueOrThrow({ where: { caseId } });
    expect(property.latitude?.toFixed(7)).toBe('9.0100000');
    // The coordinates choose the location zone that prices the land, so figures
    // calculated before the property had any no longer stand.
    expect(await verified()).toBe(false);
    const located = await calculateValuation(maker, request(), CTX);
    expect(await verified()).toBe(true);
    // The point is in no location zone of Adama, so the city rate still applies.
    const run = await prisma.calculationRun.findFirstOrThrow({
      where: { valuation: { caseId } },
      orderBy: { performedAt: 'desc' },
    });
    const working = run.outputSnapshot as {
      land: { maxRate: { source: string }; coordinates: unknown };
    };
    expect(working.land.coordinates).toEqual({ latitude: '9.01', longitude: '38.76' });
    expect(working.land.maxRate.source).toBe('CITY_TABLE');
    expect(located.version).toBe(1);

    await checkIn({ latitude: '9.0105000', longitude: '38.7600000', accuracyMeters: '15' });
    const near = await latestVisit();
    expect(near.locationCheck).toBe('VERIFIED');
    expect(Number(near.distanceMeters)).toBeCloseTo(55.6, 0);
    expect(near.radiusMeters).toBe(200);

    await checkIn({ latitude: '9.0600000', longitude: '38.7600000', accuracyMeters: '10' });
    expect((await latestVisit()).locationCheck).toBe('OUTSIDE_RADIUS');

    await checkIn({ latitude: '9.0100000', longitude: '38.7600000', accuracyMeters: '900' });
    expect((await latestVisit()).locationCheck).toBe('LOW_ACCURACY');

    const evidence = await loadSiteVisitEvidence(checker, caseId);
    expect(evidence?.onSite?.check).toBe('VERIFIED');
    expect(evidence?.latest?.check).toBe('LOW_ACCURACY');
  });

  it('tells the Maker Manager of each visit, flagging one that does not prove presence', async () => {
    const notices = await prisma.notification.findMany({
      where: { caseId, recipientId: manager.id, eventType: { startsWith: 'SITE_VISIT_' } },
      select: { eventType: true, subject: true, body: true },
    });
    const recorded = notices.filter((n) => n.eventType === 'SITE_VISIT_RECORDED');
    const flagged = notices.filter((n) => n.eventType === 'SITE_VISIT_FLAGGED');
    // Verified and located visits are news; the far, vague and unlocated ones are flags.
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    expect(flagged.length).toBeGreaterThanOrEqual(3);
    expect(flagged.some((n) => /km from the property/.test(n.body))).toBe(true);
    expect(flagged.some((n) => /without a location/.test(n.body))).toBe(true);
    // Nobody is told of their own action.
    expect(
      await prisma.notification.count({
        where: { caseId, recipientId: maker.id, eventType: { startsWith: 'SITE_VISIT_' } },
      }),
    ).toBe(0);
  });

  it('stamps a site photo with where it was taken, for the visit’s own valuator only', async () => {
    const visit = await latestVisit();
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      Buffer.alloc(64),
    ]);
    const upload = (actor: Actor, extra: Partial<Parameters<typeof uploadDocument>[1]> = {}) =>
      uploadDocument(
        actor,
        {
          caseId,
          categoryCode: 'SITE_PHOTO',
          filename: 'site.jpg',
          declaredMime: 'image/jpeg',
          bytes: jpeg,
          sitePhoto: {
            siteVisitId: visit.id,
            position: { latitude: 9.0101, longitude: 38.76, accuracyMeters: 8 },
          },
          ...extra,
        },
        CTX,
      );

    const onSite = await upload(maker);
    const stored = await prisma.propertyDocument.findUniqueOrThrow({ where: { id: onSite.id } });
    expect(stored.siteVisitId).toBe(visit.id);
    // Named by the server: a second "site.jpg" from the camera must not collide.
    expect(stored.originalFilename).toMatch(/^site-photo-\d{8}-\d{6}-[0-9a-f]{6}\.jpg$/);
    expect(stored.locationCheck).toBe('VERIFIED');
    expect(Number(stored.distanceMeters)).toBeCloseTo(11.1, 0);

    const unlocated = await upload(maker, {
      sitePhoto: { siteVisitId: visit.id, position: null },
    });
    expect(
      (await prisma.propertyDocument.findUniqueOrThrow({ where: { id: unlocated.id } }))
        .locationCheck,
    ).toBe('NO_LOCATION');

    await expect(upload(maker, { categoryCode: 'OTHER' })).rejects.toThrow(/site photograph/);
    await expect(upload(checker)).rejects.toThrow();
  });

  it('lists the case by its site-visit evidence', async () => {
    const { caseNumber } = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    const find = async (siteVisit: 'VERIFIED' | 'FLAGGED' | 'NONE') =>
      (await listCases(manager, { search: caseNumber, siteVisit })).rows.map((r) => r.id);
    expect(await find('VERIFIED')).toEqual([caseId]);
    expect(await find('FLAGGED')).toEqual([]);
    expect(await find('NONE')).toEqual([]);
  });

  it('lets the case move on to checking once calculated, and then freezes calculation', async () => {
    // The verified visit above satisfies the site-visit rule.
    await withSiteVisitRule(() => transition(maker, 'SUBMIT_FOR_CHECKING'));
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(theCase.status).toBe('SUBMITTED_FOR_CHECKING');

    await expect(calculateValuation(maker, request('150'), CTX)).rejects.toThrow(
      /On Progress or Returned for Correction/,
    );
  });

  it('keeps a stale workflow error distinct from the valuation guard', async () => {
    // Submitting again from the wrong status is a workflow refusal, not a
    // calculation one - the two failures must stay distinguishable.
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

  it('refuses a review comment from anyone but the assigned checker', async () => {
    await expect(
      raiseComment(maker, { caseId, section: 'LAND', body: 'I would like to flag this.' }, CTX),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('moves the case to COMMENTED on the first comment, and records each by section', async () => {
    await raiseComment(
      checker,
      { caseId, section: 'LAND', body: 'The land rate is above the recent Bole sales.' },
      CTX,
    );
    expect(await statusOf()).toBe('COMMENTED');

    // A second comment while COMMENTED adds a thread without another transition.
    await raiseComment(
      checker,
      { caseId, section: 'BUILDINGS', body: 'Confirm the construction year of building 1.' },
      CTX,
    );
    expect(await statusOf()).toBe('COMMENTED');

    const comments = await prisma.comment.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
    expect(comments.map((c) => c.section)).toEqual(['LAND', 'BUILDINGS']);
    const history = await prisma.workflowHistory.count({
      where: { caseId, action: 'ADD_CHECKER_COMMENT' },
    });
    expect(history).toBe(1);
  });

  it('refuses to complete checking while a comment is open', async () => {
    await expect(transition(checker, 'COMPLETE_CHECKING')).rejects.toThrow(/unresolved/);
  });

  it('lets only the checker resolve a comment', async () => {
    const comment = await prisma.comment.findFirstOrThrow({ where: { caseId, section: 'LAND' } });
    await expect(
      setCommentResolved(maker, { caseId, commentId: comment.id, resolved: true }, CTX),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns for correction, recording the flagged sections and ending the review task', async () => {
    await transition(checker, 'RETURN_FOR_CORRECTION', {
      comment: 'Please address both review comments and recalculate.',
    });
    expect(await statusOf()).toBe('RETURNED_FOR_CORRECTION');

    const cycle = await prisma.correctionCycle.findFirstOrThrow({ where: { caseId } });
    expect(cycle.flaggedSections).toEqual(expect.arrayContaining(['LAND', 'BUILDINGS']));
    expect(cycle.resolvedAt).toBeNull();

    expect(await openTask('PERFORM_CHECKING')).toBeNull();
    expect((await openTask('CORRECT_VALUATION'))?.assigneeId).toBe(maker.id);
    expect((await currentValuation()).status).toBe('DRAFT');
  });

  it('lets the maker answer and recalculate while the case is returned', async () => {
    const comment = await prisma.comment.findFirstOrThrow({ where: { caseId, section: 'LAND' } });
    await replyToComment(
      maker,
      { caseId, parentId: comment.id, body: 'Fence re-measured on site at 100 m².' },
      CTX,
    );
    const result = await calculateValuation(maker, request('100'), CTX);
    expect(result.version).toBe(1);
    expect(await verified()).toBe(true);
  });

  it('requires a note of what was corrected before resubmission', async () => {
    await expect(transition(maker, 'RESUBMIT')).rejects.toThrow(BusinessRuleError);
  });

  it('resubmits to the same checker and closes the correction cycle with its rework time', async () => {
    await transition(maker, 'RESUBMIT', {
      comment: 'Land rate revised and construction year confirmed from the permit.',
    });
    expect(await statusOf()).toBe('CHECKING');

    const cycle = await prisma.correctionCycle.findFirstOrThrow({ where: { caseId } });
    expect(cycle.resolvedAt).not.toBeNull();
    expect(cycle.resolutionNote).toContain('Land rate revised');
    expect(cycle.reworkSeconds).toBeGreaterThanOrEqual(0);

    // The review task reopens for the same checker - the round trip that used
    // to collide with a task left open by the return.
    expect((await openTask('PERFORM_CHECKING'))?.assigneeId).toBe(checker.id);
    expect((await currentValuation()).status).toBe('UNDER_CHECK');
  });

  it('completes checking once every comment is resolved, recording the checker', async () => {
    const open = await prisma.comment.findMany({ where: { caseId, parentId: null } });
    for (const comment of open) {
      await setCommentResolved(checker, { caseId, commentId: comment.id, resolved: true }, CTX);
    }

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
      siteInspection: { check: string; photos: { id: string; sha256: string; check: string }[] }[];
    };
    const theCase = await prisma.valuationCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(document.valuation.marketValue).toBe(theCase.finalValue?.toFixed(2));
    expect(document.approvals[0]?.level).toBe('CHECKER');
    expect(document.signer.id).toBe(director.id);

    // The site inspection is part of what was signed: every visit, and each
    // photo by its fingerprint.
    expect(document.siteInspection).toHaveLength(
      await prisma.siteVisit.count({ where: { caseId } }),
    );
    const photos = document.siteInspection.flatMap((v) => v.photos);
    const stored = await prisma.propertyDocument.findMany({
      where: { caseId, siteVisitId: { not: null } },
      select: { id: true, sha256: true },
    });
    expect(photos.map((p) => p.id).sort()).toEqual(stored.map((p) => p.id).sort());
    expect(photos.every((p) => stored.some((s) => s.id === p.id && s.sha256 === p.sha256))).toBe(
      true,
    );

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
