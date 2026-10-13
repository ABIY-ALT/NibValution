import { z } from 'zod';
import {
  CONDITION_GRADES,
  CONSTRUCTION_STATUSES,
  LAND_HOLDING_RIGHTS,
} from '@/server/domain/shared/enums';

/**
 * Property registration input (spec sections 6 and 7).
 *
 * Numbers arrive from HTML inputs as strings, so every numeric field is coerced
 * and bounded here. Areas and monetary values stay as *strings* all the way to
 * the database: parsing an ETB amount into a JavaScript number to validate it
 * would be the exact rounding mistake rule 15 forbids.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** A non-negative decimal, kept as a string. */
const decimalString = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || /^\d+(\.\d{1,4})?$/.test(v), {
      message: `${label} must be a positive number.`,
    });

const year = z.coerce
  .number()
  .int()
  .min(1900, 'Year looks too early.')
  .max(new Date().getUTCFullYear() + 1, 'Year cannot be in the future.')
  .optional();

const optionalInt = (label: string, max: number) =>
  z.coerce
    .number()
    .int()
    .min(0, `${label} cannot be negative.`)
    .max(max, `${label} looks too large.`)
    .optional();

// ---------------------------------------------------------------------------
// Civil
// ---------------------------------------------------------------------------

export const civilPropertySchema = z.object({
  caseId: z.string().uuid(),
  categoryCode: z.string().trim().min(1, 'Choose a property category.'),

  lhcNumber: optionalText(64),
  subCity: optionalText(80),
  woreda: optionalText(80),
  kebele: optionalText(80),
  houseNumber: optionalText(40),
  geographicLocation: optionalText(240),

  latitude: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || (Number(v) >= -90 && Number(v) <= 90), {
      message: 'Latitude must be between -90 and 90.',
    }),
  longitude: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || (Number(v) >= -180 && Number(v) <= 180), {
      message: 'Longitude must be between -180 and 180.',
    }),

  landHoldingRight: z.enum(LAND_HOLDING_RIGHTS),
  plotArea: decimalString('Plot area'),
  leaseRemainingYears: optionalInt('Remaining lease years', 200),
  leaseUnpaidBalance: decimalString('Unpaid lease balance'),
  leaseAnnualRate: decimalString('Annual lease rate'),
  boundaryDescription: optionalText(400),
  remarks: optionalText(1000),
});
export type CivilPropertyInput = z.infer<typeof civilPropertySchema>;

export const buildingSchema = z.object({
  caseId: z.string().uuid(),
  buildingId: z.string().uuid().optional(),

  buildingNumber: z.coerce.number().int().min(1, 'Building number starts at 1.').max(40),
  buildingType: z.string().trim().min(2, 'Describe the building type.').max(120),
  categoryCode: optionalText(40),

  floorCount: optionalInt('Floor count', 200),
  grossArea: decimalString('Gross area'),
  builtUpArea: decimalString('Built-up area'),

  constructionStatus: z.enum(CONSTRUCTION_STATUSES),
  constructionYear: year,
  condition: z.enum(CONDITION_GRADES).optional(),

  progressPercent: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v))
    .refine((v) => v === undefined || (Number(v) >= 0 && Number(v) <= 100), {
      message: 'Progress must be between 0 and 100.',
    }),

  remarks: optionalText(600),
});
export type BuildingInput = z.infer<typeof buildingSchema>;

// ---------------------------------------------------------------------------
// Mechanical
// ---------------------------------------------------------------------------

export const mechanicalPropertySchema = z.object({
  caseId: z.string().uuid(),
  plantName: optionalText(160),
  installationAddress: optionalText(240),
  latitude: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  longitude: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === '' ? undefined : v)),
  operationalStatus: optionalText(120),
  remarks: optionalText(1000),
});

export const vehicleSchema = z.object({
  caseId: z.string().uuid(),
  vehicleId: z.string().uuid().optional(),
  categoryCode: optionalText(40),

  ownerName: optionalText(160),
  plateNumber: optionalText(32),
  chassisNumber: optionalText(64),
  engineNumber: optionalText(64),
  make: optionalText(80),
  model: optionalText(80),
  manufactureYear: year,
  capacity: optionalText(60),
  horsePower: decimalString('Horse power'),
  cylinderCount: optionalInt('Cylinder count', 24),
  axleNumber: optionalInt('Axle number', 20),
  colour: optionalText(40),
  libreReference: optionalText(64),
  condition: z.enum(CONDITION_GRADES).optional(),
  mileage: decimalString('Mileage'),
  remarks: optionalText(600),
});
export type VehicleInput = z.infer<typeof vehicleSchema>;

export const machinerySchema = z.object({
  caseId: z.string().uuid(),
  machineryId: z.string().uuid().optional(),
  categoryCode: optionalText(40),

  ownerName: optionalText(160),
  equipmentName: z.string().trim().min(2, 'Name the equipment.').max(160),
  manufacturer: optionalText(120),
  model: optionalText(80),
  serialNumber: optionalText(80),
  manufactureYear: year,
  capacity: optionalText(60),
  countryOfOrigin: optionalText(80),
  installationLocation: optionalText(160),
  condition: z.enum(CONDITION_GRADES).optional(),
  purchasePrice: decimalString('Purchase price'),
  insuranceValue: decimalString('Insurance value'),
  cifValue: decimalString('CIF value'),
  remainingLifeYears: decimalString('Remaining life'),
  remarks: optionalText(600),
});
export type MachineryInput = z.infer<typeof machinerySchema>;

export const deleteItemSchema = z.object({
  caseId: z.string().uuid(),
  itemId: z.string().uuid(),
});
