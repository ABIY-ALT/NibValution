import { z } from 'zod';

/**
 * The valuator's worksheet - what the Maker enters on top of the registered
 * property to value it (spec sections 9-13).
 *
 * Amounts stay strings end to end, exactly as in property registration: an ETB
 * figure parsed into a JavaScript number to be validated has already been
 * rounded. The server assembles the engine input from this worksheet *and* the
 * registered property, so nothing here can restate an area or a year.
 */

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const amount = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, `${label} must be a positive number (up to 4 decimals).`);

const optionalAmount = (label: string) => z.preprocess(blank, amount(label).nullable());

/** A signed percentage adjustment, -100 < x <= 100. */
const adjustment = (label: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? '0' : v),
    z
      .string()
      .trim()
      .regex(/^-?\d+(\.\d{1,4})?$/, `${label} must be a percentage, e.g. -5 or 2.5.`)
      .refine((v) => Number(v) > -100 && Number(v) <= 100, {
        message: `${label} must be above -100% and at most 100%.`,
      }),
  );

const percent = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, `${label} must be a percentage.`)
    .refine((v) => Number(v) <= 100, { message: `${label} cannot exceed 100%.` });

const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable());

const valuationDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the valuation date.')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), { message: 'Enter a real date.' })
  .refine((v) => v >= '2000-01-01', { message: 'The valuation date looks too early.' })
  .refine((v) => v <= new Date().toISOString().slice(0, 10), {
    message: 'The valuation date cannot be in the future.',
  });

const reconciliation = z
  .object({
    override: z.boolean(),
    costWeight: z.string().trim(),
    salesWeight: z.string().trim(),
    rationale: z.string().trim().max(1000),
  })
  .superRefine((value, ctx) => {
    if (!value.override) return;
    for (const key of ['costWeight', 'salesWeight'] as const) {
      const parsed = percent('Weight').safeParse(value[key]);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'Enter a weight between 0 and 100.' });
      }
    }
    if (Number(value.costWeight) + Number(value.salesWeight) !== 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['salesWeight'],
        message: 'The weights must total 100.',
      });
    }
    if (value.rationale.length < 10) {
      ctx.addIssue({
        code: 'custom',
        path: ['rationale'],
        message: 'Explain the override (10 characters minimum).',
      });
    }
  });

const forcedSale = z
  .object({
    override: z.boolean(),
    percent: z.string().trim(),
    reason: z.string().trim().max(1000),
  })
  .superRefine((value, ctx) => {
    if (!value.override) return;
    if (!percent('Forced-sale percentage').safeParse(value.percent).success) {
      ctx.addIssue({
        code: 'custom',
        path: ['percent'],
        message: 'Enter a percentage from 0 to 100.',
      });
    }
    if (value.reason.length < 10) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Explain the override (10 characters minimum).',
      });
    }
  });

const effectiveAge = z.preprocess(
  blank,
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/, 'Effective age must be a number of years.')
    .refine((v) => Number(v) <= 300, { message: 'Effective age looks too large.' })
    .nullable(),
);

// ---------------------------------------------------------------------------
// Civil
// ---------------------------------------------------------------------------

/**
 * A share or a completion, 0-100. Shares are typed as percentages here - 30
 * for a component that makes up 30% of a building's walls - where the Excel
 * sheet stores the fraction 0.3.
 */
const share = (label: string) =>
  z
    .string({ error: `${label} is required.` })
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, `${label} must be a percentage from 0 to 100.`)
    .refine((v) => Number(v) <= 100, { message: `${label} cannot exceed 100%.` });

const optionalShare = (label: string) => z.preprocess(blank, share(label).nullable());

/** One of the guideline's choices. Which choices exist is the engine's to judge. */
const choice = (message: string, max = 200) => z.string().trim().min(1, message).max(max);

const quantityItem = z.object({
  item: choice('Choose the work.', 250),
  quantity: amount('Quantity'),
  completionPercent: optionalShare('Completion'),
});

export const civilWorksheetSchema = z.object({
  valuationDate,
  location: z.object({
    city: choice('Choose the city or town.', 120),
    purpose: choice('Choose the permitted land purpose.', 60),
    propertyType: choice('Choose the property type.', 80),
    floorLevel: z.preprocess(
      blank,
      z.coerce
        .number({ error: 'The floor level must be a whole number.' })
        .int('The floor level must be a whole number.')
        .min(0, 'The floor level cannot be negative.')
        .max(200)
        .nullable(),
    ),
    utility: choice('Rate the utility.'),
    neighbourhood: choice('Rate the neighbourhood standard.'),
    roadQuality: choice('Rate the road quality.'),
    roadWidth: choice('Rate the road width.'),
    proximity: choice('Rate the proximity to the city centre.'),
    accessibility: choice('Rate the road accessibility.'),
  }),
  lease: z.object({
    totalYears: z.preprocess(
      blank,
      z.coerce
        .number()
        .int()
        .min(1, 'The lease period must be at least a year.')
        .max(200)
        .nullable(),
    ),
    totalAmount: optionalAmount('Total lease amount'),
    paidAmount: optionalAmount('Paid-up lease amount'),
    freeholdArea: optionalAmount('Free-hold area'),
  }),
  buildings: z
    .array(
      z.object({
        buildingId: z.string().uuid(),
        costType: choice('Choose the building type.', 60),
        count: amount('Number of buildings'),
        heightM: optionalAmount('Height'),
        components: z
          .array(
            z.object({
              row: z.number().int().min(1).max(10_000),
              sharePercent: share('Share'),
              completionPercent: optionalShare('Completion'),
            }),
          )
          .max(300),
        newComponents: z
          .array(
            z.object({
              category: z.string().trim().max(80),
              description: text(160),
              unitRate: amount('Unit price'),
              sharePercent: share('Share'),
              completionPercent: optionalShare('Completion'),
            }),
          )
          .max(40),
        defects: z
          .array(
            z.object({
              code: z.number().int().min(1).max(10_000),
              percent: share('Affected share'),
            }),
          )
          .max(100),
        supplementary: z.array(quantityItem).max(40),
      }),
    )
    .max(40),
  siteWorks: z.object({
    civil: z
      .array(
        z.object({
          item: choice('Choose the work.', 250),
          description: text(200),
          quantity: optionalAmount('Quantity'),
          completionPercent: optionalShare('Completion'),
          pool: z
            .object({
              length: amount('Pool length'),
              width: amount('Pool width'),
              depth: amount('Pool depth'),
            })
            .nullable(),
        }),
      )
      .max(60),
    gasStation: z.array(quantityItem).max(40),
    coffeeSite: z.array(quantityItem).max(60),
  }),
  reconciliation,
  forcedSale,
  remarks: text(4000),
});
export type CivilWorksheet = z.infer<typeof civilWorksheetSchema>;

// ---------------------------------------------------------------------------
// Mechanical
// ---------------------------------------------------------------------------

export const comparableEquipmentSchema = z.object({
  description: z.string().trim().min(2, 'Describe the comparable.').max(200),
  source: text(160),
  marketPrice: amount('Market price'),
  conditionAdjustment: adjustment('Condition adjustment'),
  ageAdjustment: adjustment('Age adjustment'),
  locationAdjustment: adjustment('Location adjustment'),
  otherAdjustment: adjustment('Other adjustment'),
});

export const mechanicalWorksheetSchema = z.object({
  valuationDate,
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        kind: z.enum(['VEHICLE', 'MACHINERY']),
        costBasis: z.enum(['CIF', 'QUOTE', 'NONE']),
        cifValue: optionalAmount('CIF value'),
        replacementQuote: optionalAmount('Replacement quote'),
        equipmentClass: z.string().trim().min(1, 'Choose an equipment class.').max(40),
        effectiveAgeOverride: effectiveAge,
        conditionAdjustmentPercent: adjustment('Condition adjustment'),
        comparables: z.array(comparableEquipmentSchema).max(10),
      }),
    )
    .max(300),
  reconciliation,
  forcedSale,
  remarks: text(2000),
});
export type MechanicalWorksheet = z.infer<typeof mechanicalWorksheetSchema>;

export const calculateRequestSchema = z.discriminatedUnion('discipline', [
  z.object({
    discipline: z.literal('CIVIL'),
    caseId: z.string().uuid(),
    worksheet: civilWorksheetSchema,
  }),
  z.object({
    discipline: z.literal('MECHANICAL'),
    caseId: z.string().uuid(),
    worksheet: mechanicalWorksheetSchema,
  }),
]);
export type CalculateRequest = z.infer<typeof calculateRequestSchema>;

// ---------------------------------------------------------------------------
// Site visits (Phase 3)
// ---------------------------------------------------------------------------

/** A GPS reading from the phone; absent when no position was captured. */
const reading = (min: number, max: number, message: string) =>
  z.preprocess(
    (v) => (v === undefined ? null : blank(v)),
    z.coerce.number({ error: message }).min(min, message).max(max, message).nullable(),
  );

/**
 * A visit is a check-in. There is no date to enter: the server stamps the
 * moment it is recorded, so a visit cannot be back-dated. The position comes
 * from the phone's GPS and is judged on the server against the property.
 */
const position = {
  latitude: reading(-90, 90, 'The captured latitude is not valid.'),
  longitude: reading(-180, 180, 'The captured longitude is not valid.'),
  accuracyMeters: reading(0, 1_000_000, 'The captured GPS accuracy is not valid.'),
};

/** A position is the whole reading or none of it - never a latitude alone. */
function wholeReading(
  v: { latitude: number | null; longitude: number | null; accuracyMeters: number | null },
  ctx: z.RefinementCtx,
) {
  const given = [v.latitude, v.longitude, v.accuracyMeters].filter((x) => x !== null).length;
  if (given !== 0 && given !== 3) {
    ctx.addIssue({
      code: 'custom',
      path: ['latitude'],
      message: 'The location was only partly captured. Capture it again.',
    });
  }
}

export const siteVisitSchema = z
  .object({
    caseId: z.string().uuid(),
    accessGained: z.enum(['yes', 'no']).transform((v) => v === 'yes'),
    findings: text(2000),
    remarks: text(1000),
    ...position,
  })
  .superRefine(wholeReading);
export type SiteVisitInput = z.infer<typeof siteVisitSchema>;

/** The fields that make an upload a site photo: its visit, and where the phone was. */
export const sitePhotoSchema = z
  .object({ siteVisitId: z.string().uuid('The site visit was not recognised.'), ...position })
  .superRefine(wholeReading);
export type SitePhotoInput = z.infer<typeof sitePhotoSchema>;
