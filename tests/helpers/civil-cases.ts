import type { CivilBuildingInput, CivilEngineInput } from '@/server/domain/valuation/civil-engine';

/**
 * Small civil cases for the engine's rule tests: a villa on a plot, with the
 * best location ratings, so that each test changes one thing and the rest of
 * the arithmetic stays easy to follow by hand.
 */

/** The first choice of every location rating: each factor is 1 but the built-up area ratio. */
export const BEST_RATINGS = {
  utility: 'Excellent (Available)',
  neighbourhood: 'Excellent (Very Attractive)',
  roadQuality: 'Stable Asphalt',
  roadWidth: 'Access Road Width >= 15m',
  proximity: 'Excellent (Center)',
  accessibility: 'Within 100m',
} as const;

/**
 * A single-storey villa of 160 m² with a masonry foundation (catalogue row 11,
 * Excellent grade, weight 21%) and an RC structure (row 14, Luxury, 10%).
 */
export function villa(overrides: Partial<CivilBuildingInput> = {}): CivilBuildingInput {
  return {
    buildingId: 'b1',
    buildingNumber: 1,
    name: 'Main house',
    constructionStatus: 'COMPLETED',
    progressPercent: null,
    floorArea: '160',
    builtUpArea: '160',
    costType: 'Villa',
    count: '1',
    heightM: null,
    components: [
      { row: 11, sharePercent: '100', completionPercent: null },
      { row: 14, sharePercent: '100', completionPercent: null },
    ],
    newComponents: [],
    defects: [],
    supplementary: [],
    ...overrides,
  };
}

type Overrides = {
  location?: Partial<CivilEngineInput['location']>;
  land?: Partial<CivilEngineInput['land']>;
  buildings?: CivilEngineInput['buildings'];
  siteWorks?: Partial<CivilEngineInput['siteWorks']>;
  reconciliation?: CivilEngineInput['reconciliation'];
  forcedSale?: CivilEngineInput['forcedSale'];
};

/** The villa on 400 m² of free-hold residential land in Adama, with no coordinates. */
export function villaCase(overrides: Overrides = {}): CivilEngineInput {
  return {
    valuationDate: '2026-09-01',
    location: {
      city: 'Adama',
      purpose: 'RESIDENTIAL',
      propertyType: 'Residential Building',
      floorLevel: null,
      ...BEST_RATINGS,
      ...overrides.location,
    },
    land: {
      holdingRight: 'FREEHOLD',
      plotArea: '400',
      latitude: null,
      longitude: null,
      leaseRemainingYears: null,
      leaseTotalYears: null,
      leaseTotalAmount: null,
      leasePaidAmount: null,
      freeholdArea: null,
      ...overrides.land,
    },
    buildings: overrides.buildings ?? [villa()],
    siteWorks: { civil: [], gasStation: [], coffeeSite: [], ...overrides.siteWorks },
    reconciliation: overrides.reconciliation ?? null,
    forcedSale: overrides.forcedSale ?? null,
  };
}
