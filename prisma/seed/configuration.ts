import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import guidelineTables from './guideline/v4.2.json';

/**
 * Seeds every business rule that spec section 37 requires to be configurable.
 *
 * Nothing here is a code constant: these rows are what the application reads at
 * runtime, and an administrator can change any of them through the admin UI
 * without a deployment. The values below are the defaults recorded in
 * docs/00-assumptions-and-open-questions.md - several are marked there as
 * awaiting confirmation from the Property Valuation Department.
 */

const EPOCH = new Date('2020-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// Request types (spec section 4)
// ---------------------------------------------------------------------------

const REQUEST_TYPES = [
  {
    code: 'NEW',
    name: 'New',
    description: 'First valuation of a property offered as collateral.',
    requiresPriorCase: false,
    sortOrder: 1,
  },
  {
    code: 'RE_ESTIMATION',
    name: 'Re-Estimation',
    description: 'Revaluation of a previously valued property. References the prior case.',
    requiresPriorCase: true,
    sortOrder: 2,
  },
  {
    code: 'PROGRESS',
    name: 'Progress',
    description:
      'Periodic valuation of a construction-in-progress property supporting staged disbursement. Definition pending PVD confirmation (assumption 7.1).',
    requiresPriorCase: true,
    sortOrder: 3,
  },
  {
    code: 'APPEAL',
    name: 'Appeal',
    description: 'Re-valuation requested after the applicant contests an earlier estimate.',
    requiresPriorCase: true,
    sortOrder: 4,
  },
  {
    code: 'FORECLOSURE',
    name: 'Foreclosure',
    description: 'Forced-sale valuation of a property being foreclosed.',
    requiresPriorCase: false,
    sortOrder: 5,
  },
] as const;

// ---------------------------------------------------------------------------
// Property categories (spec section 5)
// ---------------------------------------------------------------------------

type CategorySeed = {
  code: string;
  name: string;
  discipline: 'CIVIL' | 'MECHANICAL';
  children?: readonly Omit<CategorySeed, 'discipline' | 'children'>[];
};

const PROPERTY_CATEGORIES: readonly CategorySeed[] = [
  // --- Civil (flat) ---
  { code: 'CIV_RESIDENTIAL', name: 'Residential', discipline: 'CIVIL' },
  { code: 'CIV_COMMERCIAL', name: 'Commercial', discipline: 'CIVIL' },
  { code: 'CIV_INDUSTRIAL', name: 'Industrial', discipline: 'CIVIL' },
  { code: 'CIV_HALL_WAREHOUSE', name: 'Multipurpose Hall / Warehouse', discipline: 'CIVIL' },
  { code: 'CIV_SHOP', name: 'Shop', discipline: 'CIVIL' },
  { code: 'CIV_HOTEL', name: 'Hotel', discipline: 'CIVIL' },
  { code: 'CIV_RESORT', name: 'Resort', discipline: 'CIVIL' },
  { code: 'CIV_COFFEE_SITE', name: 'Coffee Site', discipline: 'CIVIL' },
  { code: 'CIV_HOSPITAL', name: 'Hospital', discipline: 'CIVIL' },
  { code: 'CIV_CONDOMINIUM', name: 'Condominium', discipline: 'CIVIL' },
  { code: 'CIV_APARTMENT', name: 'Apartment', discipline: 'CIVIL' },
  { code: 'CIV_OTHER', name: 'Other', discipline: 'CIVIL' },

  // --- Mechanical (three groups, as the source structures them) ---
  {
    code: 'MEC_PLANT',
    name: 'Plant',
    discipline: 'MECHANICAL',
    children: [
      { code: 'MEC_PLANT_MANUFACTURING', name: 'Manufacturing plant' },
      { code: 'MEC_PLANT_PROCESSING', name: 'Processing plant' },
      { code: 'MEC_PLANT_POWER', name: 'Power plant' },
      { code: 'MEC_PLANT_WATER', name: 'Water treatment plant' },
      { code: 'MEC_PLANT_WASTE', name: 'Waste treatment plant' },
      { code: 'MEC_PLANT_OTHER', name: 'Other plants' },
    ],
  },
  {
    code: 'MEC_MACHINERY',
    name: 'Industrial Manufacturing Machinery',
    discipline: 'MECHANICAL',
    children: [
      { code: 'MEC_MACH_PRODUCTION', name: 'Production machinery' },
      { code: 'MEC_MACH_MATERIAL_HANDLING', name: 'Material handling equipment' },
      { code: 'MEC_MACH_WORKSHOP', name: 'Workshop machinery' },
      { code: 'MEC_MACH_PACKAGING', name: 'Packaging machinery' },
      { code: 'MEC_MACH_AUXILIARY', name: 'Auxiliary / supporting equipment' },
      { code: 'MEC_MACH_QUALITY', name: 'Quality control / testing equipment' },
      { code: 'MEC_MACH_ENVIRONMENTAL', name: 'Environmental / waste-management equipment' },
    ],
  },
  {
    code: 'MEC_VEHICLES',
    name: 'Vehicles',
    discipline: 'MECHANICAL',
    children: [
      { code: 'MEC_VEH_PASSENGER', name: 'Passenger vehicles' },
      { code: 'MEC_VEH_CARGO', name: 'Loading / cargo vehicles' },
      { code: 'MEC_VEH_CONSTRUCTION', name: 'Construction equipment' },
      { code: 'MEC_VEH_AGRICULTURAL', name: 'Agricultural equipment' },
      { code: 'MEC_VEH_OTHER', name: 'Other mechanical properties' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Document categories (spec section 8)
// ---------------------------------------------------------------------------
//
// Every category is optional, at the bank's request: no upload is needed to
// submit a request or to send a valuation for checking. The required-documents
// guard still reads isMandatory, so setting it on a category restores the
// requirement for that category.

const DOCUMENT_CATEGORIES = [
  { code: 'LHC', name: 'Land Holding Certificate (LHC)', discipline: 'CIVIL', isMandatory: false },
  {
    code: 'PROPERTY_PLAN',
    name: 'Property plan / drawing',
    discipline: 'CIVIL',
    isMandatory: false,
  },
  {
    code: 'LIBRE',
    name: 'Vehicle ownership certificate (Libre)',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  {
    code: 'COMMERCIAL_INVOICE',
    name: 'Commercial invoice',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  {
    code: 'PROFORMA_INVOICE',
    name: 'Proforma invoice',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  { code: 'PACKING_LIST', name: 'Packing list', discipline: 'MECHANICAL', isMandatory: false },
  {
    code: 'CUSTOMS_DECLARATION',
    name: 'Customs declaration',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  { code: 'INSURANCE', name: 'Insurance documents', discipline: null, isMandatory: false },
  { code: 'CIF', name: 'CIF documents', discipline: 'MECHANICAL', isMandatory: false },
  {
    code: 'EQUIPMENT_MANUAL',
    name: 'Equipment manuals',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  {
    code: 'ASSEMBLY_DRAWING',
    name: 'Assembly drawings',
    discipline: 'MECHANICAL',
    isMandatory: false,
  },
  { code: 'SITE_PHOTO', name: 'Site photographs', discipline: null, isMandatory: false },
  { code: 'REQUEST_LETTER', name: 'Request letter', discipline: null, isMandatory: false },
  { code: 'OTHER', name: 'Other supporting document', discipline: null, isMandatory: false },
] as const;

// ---------------------------------------------------------------------------
// Approval thresholds (spec section 17)
// ---------------------------------------------------------------------------
//
// Bands are half-open [min, max). The source reads "up to ETB 5 million" as
// inclusive and "above ETB 5 million" as exclusive, so the boundary sits at
// 5,000,000.01 - the smallest amount that is genuinely above 5 million once
// values are held to two decimals. The same reasoning gives 80,000,000 as an
// inclusive lower bound for the director band ("80 million and above").

const APPROVAL_THRESHOLDS = [
  {
    name: 'Up to ETB 5 million',
    minAmount: '0',
    maxAmount: '5000000.01',
    approvalChain: ['CHECKER'],
  },
  {
    name: 'Above ETB 5 million and below ETB 80 million',
    minAmount: '5000000.01',
    maxAmount: '80000000',
    approvalChain: ['CHECKER', 'MAKER_MANAGER'],
  },
  {
    name: 'ETB 80 million and above',
    minAmount: '80000000',
    maxAmount: null,
    approvalChain: ['CHECKER', 'MAKER_MANAGER', 'DIRECTOR'],
  },
] as const;

// Final-letter authority (spec section 18) - a separate ladder from approval.
// The source does not state who issues the letter at exactly ETB 100 million;
// it is assigned to the Director here, the more senior of the two.
const FINAL_LETTER_AUTHORITIES = [
  {
    name: 'Below ETB 100 million',
    minAmount: '0',
    maxAmount: '100000000',
    issuerRole: 'MAKER_MANAGER',
  },
  {
    name: 'ETB 100 million and above',
    minAmount: '100000000',
    maxAmount: null,
    issuerRole: 'DIRECTOR',
  },
] as const;

// ---------------------------------------------------------------------------
// Valuation parameters (spec sections 9-13)
// ---------------------------------------------------------------------------

type ParamSeed = {
  key: string;
  name: string;
  type: 'RATE' | 'FACTOR' | 'PERCENT' | 'AMOUNT' | 'YEARS' | 'TABLE';
  numericValue?: string;
  jsonValue?: Prisma.InputJsonValue;
  unit?: string;
  discipline?: 'CIVIL' | 'MECHANICAL';
  notes?: string;
};

const VALUATION_PARAMETERS: readonly ParamSeed[] = [
  {
    key: 'reconciliation.cost_weight',
    name: 'Reconciliation weight - cost approach',
    type: 'PERCENT',
    numericValue: '60',
    unit: '%',
    notes:
      'Default weighting for mechanical items. Must sum to 100 with the sales weight. Civil properties take the guideline weights (guideline.reconciliation). Awaiting PVD confirmation (assumption 3.2).',
  },
  {
    key: 'reconciliation.sales_weight',
    name: 'Reconciliation weight - sales approach',
    type: 'PERCENT',
    numericValue: '40',
    unit: '%',
    notes: 'Default weighting. Awaiting PVD confirmation (assumption 3.2).',
  },
  {
    key: 'forced_sale.percent',
    name: 'Forced-sale percentage of market value',
    type: 'PERCENT',
    numericValue: '75',
    unit: '%',
    notes:
      'Applied to the market value of mechanical items. Civil properties take the guideline percentage for the city and land purpose (guideline.foreclosure). Awaiting PVD confirmation (assumption 3.4).',
  },
  {
    key: 'cost_approach.mcf',
    name: 'MCF (market/cost correction factor)',
    type: 'FACTOR',
    numericValue: '1.000000',
    notes:
      'No longer read: the civil engine takes the market condition factor for the city and land purpose from the guideline table guideline.cities.',
  },
  {
    key: 'depreciation.method',
    name: 'Depreciation method',
    type: 'TABLE',
    jsonValue: { method: 'STRAIGHT_LINE' },
    notes: 'Selectable per category. Awaiting PVD confirmation (assumption 3.3).',
  },
  {
    key: 'depreciation.residual_percent',
    name: 'Residual value floor',
    type: 'PERCENT',
    numericValue: '10',
    unit: '%',
    notes: 'Depreciation never reduces a property below this percentage of replacement cost.',
  },
  {
    key: 'depreciation.economic_life',
    name: 'Economic life by construction type (years)',
    type: 'TABLE',
    discipline: 'CIVIL',
    jsonValue: {
      RCC_FRAME: 60,
      MASONRY: 50,
      STEEL_FRAME: 45,
      HCB_WALL: 40,
      TIMBER: 25,
      CORRUGATED_SHEET: 20,
      DEFAULT: 50,
    },
    notes:
      'No longer read: the civil engine depreciates a building by its recorded condition defects (guideline.condition_defects). Mechanical items use mechanical.economic_life.',
  },
  {
    key: 'depreciation.condition_modifiers',
    name: 'Condition modifiers for the age-life method',
    type: 'TABLE',
    jsonValue: {
      EXCELLENT: '0.70',
      VERY_GOOD: '0.85',
      GOOD: '1.00',
      FAIR: '1.15',
      POOR: '1.35',
      SCRAP: '1.00',
    },
  },
  {
    key: 'construction.element_weights',
    name: 'Element completion weights for properties under construction',
    type: 'TABLE',
    discipline: 'CIVIL',
    jsonValue: {
      SUBSTRUCTURE: 20,
      SUPERSTRUCTURE: 35,
      FINISHING: 30,
      SERVICES: 15,
    },
    notes:
      'No longer read: a building under construction is valued from the completion of each of its components.',
  },
  {
    key: 'mechanical.cif_loadings',
    name: 'CIF loadings (duty, freight, installation)',
    type: 'TABLE',
    discipline: 'MECHANICAL',
    jsonValue: { DUTY_PERCENT: 10, INLAND_FREIGHT_PERCENT: 5, INSTALLATION_PERCENT: 5 },
    notes:
      'Applied when replacement cost is derived from CIF value. Awaiting PVD confirmation (assumption 3.7).',
  },
  {
    key: 'mechanical.economic_life',
    name: 'Economic life by equipment class (years)',
    type: 'TABLE',
    discipline: 'MECHANICAL',
    jsonValue: {
      PASSENGER_VEHICLE: 12,
      CARGO_VEHICLE: 15,
      CONSTRUCTION_EQUIPMENT: 12,
      AGRICULTURAL_EQUIPMENT: 12,
      PRODUCTION_MACHINERY: 20,
      PLANT: 25,
      DEFAULT: 15,
    },
    notes: 'Indicative table. Awaiting PVD confirmation.',
  },
  {
    key: 'land.lease_valuation_basis',
    name: 'Lease-held land valuation basis',
    type: 'TABLE',
    discipline: 'CIVIL',
    jsonValue: { basis: 'REMAINING_TERM', includeUnpaidLeaseBalance: true },
    notes:
      'No longer read: the civil engine values lease-held land by the guideline rule (guideline.location_value).',
  },
  // The valuation guideline's reference tables and the switches that correct
  // the Excel workbook's known issues, as scripts/guideline/build-tables.mjs
  // builds them. The same file fills migration 20261009120000 for a database
  // that already exists; this is the copy a fresh install starts from.
  ...(guidelineTables as { key: string; name: string; notes: string; value: unknown }[]).map(
    (table): ParamSeed => ({
      key: table.key,
      name: table.name,
      type: 'TABLE',
      discipline: 'CIVIL',
      jsonValue: table.value as Prisma.InputJsonValue,
      notes: table.notes,
    }),
  ),
];

// ---------------------------------------------------------------------------
// Notification rules (spec section 23)
// ---------------------------------------------------------------------------

const NOTIFICATION_RULES = [
  {
    eventType: 'CASE_REQUESTED',
    roles: ['MAKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'case-requested',
  },
  {
    eventType: 'CASE_ASSIGNED',
    roles: ['MAKER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'case-assigned',
  },
  {
    eventType: 'CASE_SUBMITTED_FOR_CHECKING',
    roles: ['CHECKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'case-submitted',
  },
  {
    eventType: 'CHECKER_ASSIGNED',
    roles: ['CHECKER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'checker-assigned',
  },
  {
    eventType: 'CASE_RETURNED',
    roles: ['MAKER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'case-returned',
  },
  { eventType: 'COMMENT_ADDED', roles: ['MAKER'], channels: ['IN_APP'], template: 'comment-added' },
  {
    eventType: 'CHECKING_COMPLETED',
    roles: ['MAKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'checking-completed',
  },
  {
    eventType: 'MANAGER_APPROVAL_REQUIRED',
    roles: ['MAKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'approval-required',
  },
  {
    eventType: 'DIRECTOR_APPROVAL_REQUIRED',
    roles: ['DIRECTOR'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'approval-required',
  },
  {
    eventType: 'SLA_APPROACHING',
    roles: ['MAKER', 'CHECKER', 'MAKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'sla-approaching',
  },
  {
    eventType: 'SLA_BREACHED',
    roles: ['MAKER_MANAGER', 'CHECKER_MANAGER', 'DIRECTOR'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'sla-breached',
  },
  {
    eventType: 'CASE_COMPLETED',
    roles: ['PROCESS_OWNER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'case-completed',
  },
  {
    eventType: 'FINAL_REPORT_AVAILABLE',
    roles: ['PROCESS_OWNER'],
    channels: ['IN_APP', 'EMAIL', 'SMS'],
    template: 'report-available',
  },
  {
    eventType: 'SITE_VISIT_RECORDED',
    roles: ['MAKER_MANAGER'],
    channels: ['IN_APP'],
    template: 'site-visit-recorded',
  },
  {
    eventType: 'SITE_VISIT_FLAGGED',
    roles: ['MAKER_MANAGER'],
    channels: ['IN_APP', 'EMAIL'],
    template: 'site-visit-flagged',
  },
] as const;

// ---------------------------------------------------------------------------
// System configuration
// ---------------------------------------------------------------------------

const SYSTEM_CONFIG: readonly {
  key: string;
  value: Prisma.InputJsonValue;
  valueType: string;
  description: string;
}[] = [
  {
    key: 'approval.basis',
    value: 'RECONCILED_MARKET_VALUE',
    valueType: 'string',
    description:
      'Which figure drives approval routing. A forced-sale value never lowers the approval level (assumption 1.3).',
  },
  {
    key: 'case.max_buildings',
    value: 40,
    valueType: 'number',
    description: 'Maximum buildings per civil case (spec section 6).',
  },
  {
    key: 'case.max_mechanical_items',
    value: 300,
    valueType: 'number',
    description: 'Maximum vehicles plus machinery per mechanical case (spec section 7).',
  },
  {
    key: 'case.number_prefix',
    value: 'PV',
    valueType: 'string',
    description: 'Case number prefix, e.g. PV-2026-000001.',
  },
  {
    key: 'upload.max_file_bytes',
    value: 26_214_400,
    valueType: 'number',
    description: 'Maximum size of a single upload (25 MB).',
  },
  {
    key: 'upload.max_case_bytes',
    value: 524_288_000,
    valueType: 'number',
    description: 'Maximum total uploads per case (500 MB).',
  },
  {
    key: 'upload.allowed_mime_types',
    value: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/vnd.dwg',
      'application/acad',
    ],
    valueType: 'array',
    description:
      'Upload allow-list. Validated against sniffed content, not the declared header (assumption 6.3).',
  },
  {
    key: 'archive.retention_days_before_archive',
    value: 30,
    valueType: 'number',
    description: 'Days after completion before a case may be archived.',
  },
  {
    key: 'signature.reauth_window_seconds',
    value: 300,
    valueType: 'number',
    description: 'How recently a signer must have re-authenticated (spec section 19).',
  },
  {
    key: 'security.max_failed_logins',
    value: 5,
    valueType: 'number',
    description: 'Failed attempts before lockout.',
  },
  {
    key: 'security.login_attempts_per_ip',
    value: 100,
    valueType: 'number',
    description:
      'Sign-in attempts allowed from one network address in 5 minutes. An office behind one proxy shares an address, so this must cover everyone there signing in at once; per-account lockout protects individual accounts.',
  },
  {
    key: 'security.lockout_minutes',
    value: 15,
    valueType: 'number',
    description: 'Lockout duration after repeated failures.',
  },
  {
    key: 'security.password_min_length',
    value: 6,
    valueType: 'number',
    description:
      'Minimum password length. Set to 6 by request of the bank; raise it here to tighten the rule without a deployment.',
  },
  {
    key: 'security.password_require_complexity',
    value: 0,
    valueType: 'number',
    description:
      'Set to 1 to require an upper-case letter, a lower-case letter, a digit and a symbol. Off by default so a 6-character password is usable.',
  },
  {
    key: 'security.password_history',
    value: 5,
    valueType: 'number',
    description: 'Number of previous passwords that may not be reused.',
  },
  {
    key: 'security.password_expiry_days',
    value: 90,
    valueType: 'number',
    description: 'Password maximum age.',
  },
  {
    key: 'comment.min_length',
    value: 10,
    valueType: 'number',
    description: 'Minimum length of a mandatory return comment (spec section 33).',
  },
  {
    key: 'site_visit.radius_meters',
    value: 200,
    valueType: 'number',
    description:
      'How close to the property, in metres, a site check-in must be to count as verified on site. Widen it for large compounds.',
  },
  {
    key: 'site_visit.max_accuracy_meters',
    value: 100,
    valueType: 'number',
    description:
      'The vaguest GPS fix, in metres, a check-in may report and still be judged. A vaguer fix is recorded as low accuracy.',
  },
  {
    key: 'site_visit.require_on_site',
    value: 0,
    valueType: 'number',
    description:
      'Set to 1 so a case can be submitted for checking only with a visit checked in at the property, or one whose remarks explain why it could not be.',
  },
];

// ---------------------------------------------------------------------------

export async function seedConfiguration(prisma: PrismaClient): Promise<void> {
  for (const type of REQUEST_TYPES) {
    await prisma.requestType.upsert({
      where: { code: type.code },
      update: {
        name: type.name,
        description: type.description,
        requiresPriorCase: type.requiresPriorCase,
        sortOrder: type.sortOrder,
      },
      create: { ...type },
    });
  }
  console.warn(`  request types: ${REQUEST_TYPES.length}`);

  let categoryCount = 0;
  for (const [index, category] of PROPERTY_CATEGORIES.entries()) {
    const parent = await prisma.propertyCategory.upsert({
      where: { code: category.code },
      update: { name: category.name, discipline: category.discipline, sortOrder: index + 1 },
      create: {
        code: category.code,
        name: category.name,
        discipline: category.discipline,
        sortOrder: index + 1,
      },
    });
    categoryCount += 1;

    for (const [childIndex, child] of (category.children ?? []).entries()) {
      await prisma.propertyCategory.upsert({
        where: { code: child.code },
        update: {
          name: child.name,
          discipline: category.discipline,
          parentId: parent.id,
          sortOrder: childIndex + 1,
        },
        create: {
          code: child.code,
          name: child.name,
          discipline: category.discipline,
          parentId: parent.id,
          sortOrder: childIndex + 1,
        },
      });
      categoryCount += 1;
    }
  }
  console.warn(`  property categories: ${categoryCount}`);

  for (const [index, category] of DOCUMENT_CATEGORIES.entries()) {
    await prisma.documentCategory.upsert({
      where: { code: category.code },
      update: {
        name: category.name,
        discipline: category.discipline,
        isMandatory: category.isMandatory,
        sortOrder: index + 1,
      },
      create: {
        code: category.code,
        name: category.name,
        discipline: category.discipline,
        isMandatory: category.isMandatory,
        sortOrder: index + 1,
      },
    });
  }
  console.warn(`  document categories: ${DOCUMENT_CATEGORIES.length}`);

  // Thresholds carry no natural unique key, so they are replaced wholesale on
  // an empty table only. Overwriting an operator's tuned bands on every deploy
  // would silently change approval routing - exactly what section 37 forbids.
  const existingThresholds = await prisma.approvalThreshold.count();
  if (existingThresholds === 0) {
    for (const band of APPROVAL_THRESHOLDS) {
      await prisma.approvalThreshold.create({
        data: {
          name: band.name,
          minAmount: band.minAmount,
          maxAmount: band.maxAmount,
          approvalChain: [...band.approvalChain],
          effectiveFrom: EPOCH,
        },
      });
    }
    console.warn(`  approval thresholds: ${APPROVAL_THRESHOLDS.length}`);
  } else {
    console.warn(`  approval thresholds: ${existingThresholds} already configured, left unchanged`);
  }

  const existingLetterRules = await prisma.finalLetterAuthority.count();
  if (existingLetterRules === 0) {
    for (const band of FINAL_LETTER_AUTHORITIES) {
      await prisma.finalLetterAuthority.create({
        data: {
          name: band.name,
          minAmount: band.minAmount,
          maxAmount: band.maxAmount,
          issuerRole: band.issuerRole,
          effectiveFrom: EPOCH,
        },
      });
    }
    console.warn(`  final-letter authorities: ${FINAL_LETTER_AUTHORITIES.length}`);
  } else {
    console.warn(
      `  final-letter authorities: ${existingLetterRules} already configured, left unchanged`,
    );
  }

  const parameterSet = await prisma.valuationParameterSet.upsert({
    where: { code_version: { code: 'DEFAULT', version: 1 } },
    update: {},
    create: {
      code: 'DEFAULT',
      version: 1,
      description:
        'Initial parameter set. Several values await PVD confirmation - see docs/00-assumptions-and-open-questions.md.',
      effectiveFrom: EPOCH,
    },
  });

  for (const param of VALUATION_PARAMETERS) {
    await prisma.valuationParameter.upsert({
      where: {
        setId_key_categoryCode: { setId: parameterSet.id, key: param.key, categoryCode: '' },
      },
      update: {
        name: param.name,
        type: param.type,
        numericValue: param.numericValue ?? null,
        jsonValue: param.jsonValue ?? Prisma.DbNull,
        unit: param.unit ?? null,
        discipline: param.discipline ?? null,
        notes: param.notes ?? null,
      },
      create: {
        setId: parameterSet.id,
        key: param.key,
        categoryCode: '',
        name: param.name,
        type: param.type,
        numericValue: param.numericValue ?? null,
        jsonValue: param.jsonValue ?? Prisma.DbNull,
        unit: param.unit ?? null,
        discipline: param.discipline ?? null,
        notes: param.notes ?? null,
      },
    });
  }
  console.warn(`  valuation parameters: ${VALUATION_PARAMETERS.length} (set DEFAULT v1)`);

  await prisma.slaPolicy.upsert({
    where: { code: 'STANDARD' },
    update: {},
    create: {
      code: 'STANDARD',
      name: 'Standard 5 working-day TAT',
      totalWorkingDays: 5,
      warningPercent: 80,
      stageBudgets: { ASSIGNMENT: 1, VALUATION: 2, CHECKING: 1, APPROVAL: 1 },
      workingDaysOfWeek: [1, 2, 3, 4, 5],
      countCalendarDays: false,
    },
  });
  console.warn('  SLA policy: STANDARD (5 working days)');

  for (const rule of NOTIFICATION_RULES) {
    await prisma.notificationRule.upsert({
      where: { eventType: rule.eventType },
      update: { roles: [...rule.roles], channels: [...rule.channels], template: rule.template },
      create: {
        eventType: rule.eventType,
        roles: [...rule.roles],
        channels: [...rule.channels],
        template: rule.template,
      },
    });
  }
  console.warn(`  notification rules: ${NOTIFICATION_RULES.length}`);

  for (const config of SYSTEM_CONFIG) {
    await prisma.systemConfiguration.upsert({
      where: { key: config.key },
      update: { description: config.description, valueType: config.valueType },
      create: {
        key: config.key,
        value: config.value,
        valueType: config.valueType,
        description: config.description,
      },
    });
  }
  console.warn(`  system configuration keys: ${SYSTEM_CONFIG.length}`);
}
