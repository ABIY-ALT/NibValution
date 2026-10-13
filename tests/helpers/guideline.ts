import guidelineTables from '../../prisma/seed/guideline/v4.2.json';
import goldenCase from '../../docs/guideline/v4.2/golden_case_golla_bee.json';
import type { EngineParameters } from '@/server/domain/valuation/common';
import type { CivilEngineInput } from '@/server/domain/valuation/civil-engine';
import { EXCEL_FIXES_KEY, type ExcelFix } from '@/server/domain/valuation/civil/guideline';

/**
 * The guideline tables as a parameter set, exactly as the seed and the
 * migration publish them - so an engine test reads the same data production
 * does, not a hand-copied excerpt of it.
 */
export function guidelineParameters(
  fixes: Partial<Record<ExcelFix, boolean>> = {},
  overrides: Record<string, unknown> = {},
): EngineParameters {
  const tables: Record<string, unknown> = {};
  for (const parameter of guidelineTables as { key: string; value: unknown }[]) {
    tables[parameter.key] = parameter.value;
  }
  tables[EXCEL_FIXES_KEY] = fixes;
  return {
    setCode: 'TEST',
    setVersion: 1,
    values: { 'forced_sale.percent': '75' },
    tables: { ...tables, ...overrides },
  };
}

/** A table of the guideline, for a test that needs to read a rate from it. */
export function guidelineTable<T>(key: string): T {
  const parameter = (guidelineTables as { key: string; value: unknown }[]).find(
    (p) => p.key === key,
  );
  if (!parameter) throw new Error(`No guideline table ${key}`);
  return structuredClone(parameter.value) as T;
}

export const GOLDEN = goldenCase;

const percent = (fraction: number): string => String(Number((fraction * 100).toPrecision(12)));

/**
 * The Golla Bee Production PLC case from the guideline package: every input the
 * Excel workbook was given, in the engine's terms.
 */
export function goldenInput(): CivilEngineInput {
  const g = goldenCase.general;
  const ratings = goldenCase.location_ratings;
  return {
    valuationDate: g.valuation_date,
    location: {
      city: g.city,
      purpose: g.permitted_land_purpose,
      propertyType: g.property_building_type,
      floorLevel: null,
      utility: ratings.utility.choice,
      neighbourhood: ratings.neighborhood.choice,
      roadQuality: ratings.road_quality.choice,
      roadWidth: ratings.road_width.choice,
      proximity: ratings.proximity.choice,
      accessibility: ratings.accessibility.choice,
    },
    land: {
      holdingRight: 'LEASE',
      plotArea: String(g.plot_area_m2),
      latitude: String(g.latitude),
      longitude: String(g.longitude),
      leaseRemainingYears: goldenCase.lease.remaining_lease_period,
      leaseTotalYears: goldenCase.lease.total_lease_period,
      leaseTotalAmount: String(goldenCase.lease.total_lease_amount),
      leasePaidAmount: String(goldenCase.lease.paid_up_lease_amount),
      freeholdArea: null,
    },
    buildings: goldenCase.buildings.map((b, index) => ({
      buildingId: `golden-${index + 1}`,
      buildingNumber: index + 1,
      name: b.name,
      constructionStatus: 'COMPLETED' as const,
      progressPercent: null,
      floorArea: String(b.total_floor_area_one),
      builtUpArea: String(b.built_up_area_one),
      costType: b.type,
      count: String(b.count),
      heightM: b.height_m === null ? null : String(b.height_m),
      components: b.components.map((c) => ({
        row: c.row,
        sharePercent: percent(c.share),
        completionPercent: null,
      })),
      newComponents: [],
      defects: [],
      supplementary: b.supplementary_quantities.map((s) => ({
        item: s.item,
        quantity: String(s.qty),
        completionPercent: null,
      })),
    })),
    siteWorks: {
      civil: goldenCase.plot_civil_works.map((w) => ({
        item: w.item,
        description: w.desc,
        quantity: String(w.qty),
        completionPercent: null,
        pool: null,
      })),
      gasStation: [],
      coffeeSite: [],
    },
    reconciliation: null,
    forcedSale: null,
  };
}
