/**
 * The system's civil engine against the Excel estimation template itself,
 * across every path of the calculation.
 *
 *   npx tsx scripts/guideline/excel/scenarios.mts build <template.xlsm> <scenarios.json>
 *   powershell -File scripts/guideline/excel/run-scenarios.ps1 -Workbook <template.xlsm> `
 *     -Scenarios <scenarios.json> -Out <results.json>
 *   npx tsx scripts/guideline/excel/scenarios.mts compare <scenarios.json> <results.json> [--record <fixture.json>]
 *
 * `build` writes each scenario twice over: as the input the system's engine
 * takes, and as the cells a valuator would type into the template. The
 * PowerShell runner has Excel type them into a fresh copy and recalculate.
 * `compare` runs the engine on the same inputs and sets every figure beside
 * Excel's, cell by cell.
 *
 * The scenarios cover what one filled workbook cannot: the sale approach,
 * prime zones, condominiums and apartments, the lease rules, land held both
 * ways, foreclosure, defects, new components, supplementary works, fuel
 * station and coffee site works, swimming pools, every city class, the Addis
 * Ababa tier formulas, institutional and small industrial plots, and
 * properties under construction.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import guidelineTables from '../../../prisma/seed/guideline/v4.2.json' with { type: 'json' };
import {
  calculateCivil,
  type CivilBuildingInput,
  type CivilEngineInput,
} from '../../../src/server/domain/valuation/civil-engine.ts';
import type { EngineParameters } from '../../../src/server/domain/valuation/common.ts';
import { pointInPolygon } from '../../../src/server/domain/valuation/civil/excel.ts';
import type {
  CitiesTable,
  ComponentsTable,
  PolygonsTable,
  SwimmingPoolTable,
} from '../../../src/server/domain/valuation/civil/guideline.ts';
import {
  agrees,
  block,
  compareFigures,
  printFigures,
  COMPLETED,
  PROGRESS,
  REPORT,
  REPORT_PROGRESS,
  type CellValue,
} from '../compare-figures.ts';
import { openWorkbook } from '../workbook.mjs';
import { goldenInput } from '../../../tests/helpers/guideline.ts';

const HOME = 'HOME';
const table = <T,>(key: string): T =>
  (guidelineTables as { key: string; value: unknown }[]).find((p) => p.key === key)!.value as T;
const PARAMS: EngineParameters = {
  setCode: 'GUIDELINE',
  setVersion: 1,
  values: {},
  tables: Object.fromEntries(
    (guidelineTables as { key: string; value: unknown }[]).map((p) => [p.key, p.value]),
  ),
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  /** What the case exercises, for the report. */
  about: string;
  estimationType: 'New' | 'RE-ESTIMATION' | 'FORECLOSURE';
  input: CivilEngineInput;
}

const BEST = {
  utility: 'Excellent (Available)',
  neighbourhood: 'Excellent (Very Attractive)',
  roadQuality: 'Stable Asphalt',
  roadWidth: 'Access Road Width >= 15m',
  proximity: 'Excellent (Center)',
  accessibility: 'Within 100m',
};
const MIDDLING = {
  utility: 'Very Good (Partially Available)',
  neighbourhood: 'Good ( Desired )',
  roadQuality: 'Cobble/Stone',
  roadWidth: '6m < Access Road Width <= 9m',
  proximity: 'Near Periphery of the city',
  accessibility: 'Within 250m to 350m',
};

const components = table<ComponentsTable>('guideline.building_components').components;

/**
 * A plausible make-up for a building type: the first component of each part
 * of each element in full, except the walls, split 60/40 between the first two.
 */
function typical(
  costType: string,
  completion: string | null = null,
): CivilBuildingInput['components'] {
  const list = components[costType]!;
  const seen = new Map<string, number[]>();
  for (const c of list) {
    const group = `${c.element}|${c.part ?? ''}`;
    seen.set(group, [...(seen.get(group) ?? []), c.row]);
  }
  return [...seen.entries()].flatMap(([group, rows]) =>
    /wall work/i.test(group) && rows.length > 1
      ? [
          { row: rows[0]!, sharePercent: '60', completionPercent: completion },
          { row: rows[1]!, sharePercent: '40', completionPercent: completion },
        ]
      : [{ row: rows[0]!, sharePercent: '100', completionPercent: completion }],
  );
}

let buildingCounter = 0;
function building(over: Partial<CivilBuildingInput> & { costType: string }): CivilBuildingInput {
  buildingCounter++;
  return {
    buildingId: `b${buildingCounter}`,
    buildingNumber: 1,
    name: `${over.costType} ${buildingCounter}`,
    constructionStatus: 'COMPLETED',
    progressPercent: null,
    floorArea: '160',
    builtUpArea: '160',
    count: '1',
    heightM: null,
    components: typical(over.costType),
    newComponents: [],
    defects: [],
    supplementary: [],
    ...over,
  };
}

function numbered(list: CivilBuildingInput[]): CivilBuildingInput[] {
  return list.map((b, i) => ({ ...b, buildingNumber: i + 1 }));
}

function input(over: {
  city: string;
  purpose?: string;
  propertyType?: string;
  floorLevel?: number | null;
  ratings?: Partial<typeof BEST>;
  land?: Partial<CivilEngineInput['land']>;
  buildings?: CivilBuildingInput[];
  siteWorks?: Partial<CivilEngineInput['siteWorks']>;
}): CivilEngineInput {
  return {
    valuationDate: '2026-09-22',
    location: {
      city: over.city,
      purpose: over.purpose ?? 'RESIDENTIAL',
      propertyType: over.propertyType ?? 'Residential Building',
      floorLevel: over.floorLevel ?? null,
      ...BEST,
      ...over.ratings,
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
      ...over.land,
    },
    buildings: numbered(over.buildings ?? [building({ costType: 'Villa' })]),
    siteWorks: { civil: [], gasStation: [], coffeeSite: [], ...over.siteWorks },
    reconciliation: null,
    forcedSale: null,
  };
}

/** A point inside the first zone of the city, class and grade, that no earlier zone also holds. */
function zonePoint(
  source: string,
  propertyClass: string,
  grade: string,
): { latitude: string; longitude: string; city: string } {
  const polygons = table<PolygonsTable>('guideline.location_polygons').polygons;
  const target = polygons.find(
    (p) =>
      p.source === source &&
      p.propertyClass.toLowerCase() === propertyClass.toLowerCase() &&
      p.grade === grade,
  );
  if (!target) throw new Error(`no ${source} ${propertyClass} ${grade} zone`);
  const corners = target.points.slice(0, -1);
  const centre: [number, number] = [
    corners.reduce((s, p) => s + p[0], 0) / corners.length,
    corners.reduce((s, p) => s + p[1], 0) / corners.length,
  ];
  const candidates = [
    centre,
    ...corners.map((p): [number, number] => [
      (p[0] * 3 + centre[0]) / 4,
      (p[1] * 3 + centre[1]) / 4,
    ]),
  ];
  for (const [lat, lon] of candidates) {
    const first = polygons.find(
      (p) =>
        p.source === source &&
        p.city.toLowerCase() === target.city.toLowerCase() &&
        p.propertyClass.toLowerCase() === propertyClass.toLowerCase() &&
        pointInPolygon(lat, lon, p.points) === true,
    );
    if (first === target) {
      return { latitude: lat.toFixed(7), longitude: lon.toFixed(7), city: target.city };
    }
  }
  throw new Error(`no clear point inside ${source} ${propertyClass} ${grade}`);
}

function cityOfClass(cls: string, grade?: string): string {
  const cities = table<CitiesTable>('guideline.cities').cities;
  const hit = Object.entries(cities).find(
    ([name, c]) =>
      c.class === cls && (!grade || c.grade === grade) && name !== 'Other Cities Not Listed Above',
  );
  if (!hit) throw new Error(`no city of class ${cls}`);
  return hit[0];
}

function scenarios(): Scenario[] {
  const pool = table<SwimmingPoolTable>('guideline.swimming_pool');
  const goodPool = pool.items.find((i) => i.wallFinish && i.floorFinish)!;
  const otherPool = pool.items.filter((i) => i.wallFinish && i.floorFinish)[7]!;
  const clinkerPool = pool.items.find((i) => !i.wallFinish)!;
  const prime1A = zonePoint('addis_ababa', 'Residential', 'Prime 1-A');
  const prime1B = zonePoint('addis_ababa', 'Commercial', 'Prime 1-B');
  const middleA = zonePoint('addis_ababa', 'Commercial', 'Middle - A');
  const outlineIndustrial = zonePoint('outline', 'Industrial', 'Prime');
  const list: Scenario[] = [];
  const add = (
    name: string,
    about: string,
    value: CivilEngineInput,
    estimationType: Scenario['estimationType'] = 'New',
  ) => list.push({ name, about, estimationType, input: value });

  add(
    'regional-villa',
    'Villa in a G1 city, no coordinates, best ratings',
    input({ city: 'Adama' }),
  );
  add(
    'middling-ratings',
    'Every rating mid-scale, two buildings',
    input({
      city: 'Adama',
      ratings: MIDDLING,
      land: { plotArea: '900' },
      buildings: [
        building({ costType: 'Villa' }),
        building({ costType: '2-5 Storey', floorArea: '320', builtUpArea: '110' }),
      ],
    }),
  );
  add(
    'addis-sale-above-cost',
    'Addis Ababa residence: sale approach above cost, 75/25',
    input({ city: 'Addis Ababa' }),
  );
  add(
    'addis-sale-below-cost',
    'Addis Ababa residence: sale value below cost, taken alone',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '150' },
      buildings: [building({ costType: 'Villa', floorArea: '60', builtUpArea: '60' })],
    }),
  );
  add(
    'addis-sale-negative',
    'Addis Ababa residence: regression gives no value',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '120' },
      buildings: [building({ costType: 'Villa', floorArea: '40', builtUpArea: '40' })],
    }),
  );
  add(
    'addis-prime-1a',
    'Residential zone Prime 1-A: zone rate, prime multiplier 1.53, 60/40',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '1000', latitude: prime1A.latitude, longitude: prime1A.longitude },
      buildings: [building({ costType: 'Villa', floorArea: '400', builtUpArea: '200' })],
    }),
  );
  add(
    'addis-commercial-prime-1b',
    'Commercial zone Prime 1-B: grade factor 1.21 and 1.26',
    input({
      city: 'Addis Ababa',
      purpose: 'COMMERCIAL',
      propertyType: 'Commercial Building',
      land: { plotArea: '600', latitude: prime1B.latitude, longitude: prime1B.longitude },
      buildings: [building({ costType: '6-10 Storey', floorArea: '2400', builtUpArea: '300' })],
    }),
  );
  add(
    'addis-commercial-middle-a',
    'Commercial zone Middle - A, shop purpose',
    input({
      city: 'Addis Ababa',
      purpose: 'SHOP',
      propertyType: 'Commercial Building',
      land: { plotArea: '300', latitude: middleA.latitude, longitude: middleA.longitude },
      buildings: [building({ costType: '2-5 Storey', floorArea: '450', builtUpArea: '150' })],
    }),
  );
  add(
    'condominium',
    'Condominium unit, floor 3, unit regression',
    input({
      city: 'Addis Ababa',
      propertyType: 'Condominium',
      floorLevel: 3,
      land: { plotArea: '80' },
      buildings: [building({ costType: 'Condominium', floorArea: '80', builtUpArea: '80' })],
    }),
  );
  add(
    'condominium-studio',
    'Condominium under 25 m²: small-unit rule',
    input({
      city: 'Addis Ababa',
      propertyType: 'Condominium',
      floorLevel: 1,
      land: { plotArea: '20' },
      buildings: [building({ costType: 'Condominium', floorArea: '20', builtUpArea: '20' })],
    }),
  );
  add(
    'apartment-high-floor',
    'Apartment unit on floor 8: 0.85 and x1.25',
    input({
      city: 'Addis Ababa',
      propertyType: 'Apartment',
      floorLevel: 8,
      land: { plotArea: '150' },
      buildings: [building({ costType: 'Apartment', floorArea: '150', builtUpArea: '150' })],
    }),
  );
  add(
    'lease-short-paid-branch',
    'Lease with 10 of 50 years left',
    input({
      city: 'Adama',
      land: {
        holdingRight: 'LEASE',
        leaseRemainingYears: 10,
        leaseTotalYears: 50,
        leaseTotalAmount: '1000000',
        leasePaidAmount: '400000',
      },
    }),
  );
  add(
    'lease-earned-branch',
    'Fully paid lease, half the term left',
    input({
      city: 'Adama',
      land: {
        holdingRight: 'LEASE',
        leaseRemainingYears: 15,
        leaseTotalYears: 30,
        leaseTotalAmount: '500000',
        leasePaidAmount: '500000',
      },
    }),
  );
  add(
    'lease-long',
    'Lease with 35 years left: valued in full',
    input({
      city: 'Sebeta',
      land: {
        holdingRight: 'LEASE',
        leaseRemainingYears: 35,
        leaseTotalYears: 60,
        leaseTotalAmount: '2000000',
        leasePaidAmount: '300000',
      },
    }),
  );
  add(
    'both-22-years',
    'Held both ways, 22 years left: whole plot plus lease part',
    input({
      city: 'Adama',
      land: {
        holdingRight: 'BOTH',
        freeholdArea: '150',
        leaseRemainingYears: 22,
        leaseTotalYears: 50,
        leaseTotalAmount: '1000000',
        leasePaidAmount: '400000',
      },
    }),
  );
  add(
    'both-10-years',
    'Held both ways, 10 years left',
    input({
      city: 'Adama',
      land: {
        holdingRight: 'BOTH',
        freeholdArea: '150',
        leaseRemainingYears: 10,
        leaseTotalYears: 50,
        leaseTotalAmount: '1000000',
        leasePaidAmount: '400000',
      },
    }),
  );
  add(
    'foreclosure-addis',
    'Foreclosure of an Addis Ababa residence: 80%',
    input({ city: 'Addis Ababa' }),
    'FORECLOSURE',
  );
  add(
    'foreclosure-hotel',
    'Foreclosure of a hotel: 70%',
    input({
      city: 'Adama',
      purpose: 'HOTEL',
      propertyType: 'Commercial Building',
      buildings: [building({ costType: '2-5 Storey', floorArea: '400', builtUpArea: '200' })],
    }),
    'FORECLOSURE',
  );
  add(
    'foreclosure-unlisted-city',
    'Foreclosure in an unlisted town: 70%',
    input({ city: cityOfClass('Outline Cities (G3,G4,G5)', 'G4') }),
    'FORECLOSURE',
  );
  add(
    'defects',
    'Defects on a villa, a hall and a multi-storey block',
    input({
      city: 'Adama',
      land: { plotArea: '2000' },
      buildings: [
        building({
          costType: 'Villa',
          defects: [
            { code: 7, percent: '50' },
            { code: 17, percent: '100' },
            { code: 31, percent: '30' },
          ],
        }),
        building({
          costType: 'MPH below 4m',
          floorArea: '300',
          builtUpArea: '300',
          defects: [
            { code: 7, percent: '50' },
            { code: 27, percent: '20' },
          ],
        }),
        building({
          costType: '2-5 Storey',
          floorArea: '320',
          builtUpArea: '110',
          defects: [
            { code: 38, percent: '25' },
            { code: 22, percent: '100' },
          ],
        }),
      ],
    }),
  );
  add(
    'new-components-and-supplementary',
    'New components and supplementary works on two buildings',
    input({
      city: 'Adama',
      land: { plotArea: '1200' },
      buildings: [
        building({
          costType: 'Villa',
          newComponents: [
            {
              category: 'Roofing Work',
              description: 'Green roof',
              unitRate: '800',
              sharePercent: '50',
              completionPercent: null,
            },
            {
              category: 'Floor Finish',
              description: 'Epoxy',
              unitRate: '1200',
              sharePercent: '100',
              completionPercent: null,
            },
          ],
          supplementary: [
            { item: 'HCB 10cm thick (m2)', quantity: '40', completionPercent: null },
            { item: 'Gypsum (m2)', quantity: '120', completionPercent: null },
          ],
        }),
        building({
          costType: '2-5 Storey',
          floorArea: '480',
          builtUpArea: '160',
          supplementary: [
            {
              item: 'Local Elevators with 320 Kg Capacity and Number of Stops = 5',
              quantity: '1',
              completionPercent: null,
            },
          ],
        }),
      ],
    }),
  );
  add(
    'plot-civil-works',
    'Fences, tanks, a lump-sum well, a transformer',
    input({
      city: 'Adama',
      land: { plotArea: '1000' },
      siteWorks: {
        civil: [
          {
            item: 'HCB Fence Two Sides Pointed (m2)',
            description: null,
            quantity: '224',
            completionPercent: null,
            pool: null,
          },
          {
            item: 'Masonry Septic Tank',
            description: null,
            quantity: '1',
            completionPercent: null,
            pool: null,
          },
          {
            item: 'Residential Properties: Typically 30–60 meters Deep (Lump Sum)',
            description: null,
            quantity: '1',
            completionPercent: null,
            pool: null,
          },
          {
            item: 'Plastic Tanks with Capacity of 5000 Liters (No.)',
            description: null,
            quantity: '2',
            completionPercent: null,
            pool: null,
          },
          {
            item: 'Compound work with Cobblestone Pavement (m2)',
            description: null,
            quantity: '350',
            completionPercent: null,
            pool: null,
          },
        ],
      },
    }),
  );
  add(
    'swimming-pool',
    'One swimming pool',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '800' },
      siteWorks: {
        civil: [
          {
            item: goodPool.name,
            description: null,
            quantity: null,
            completionPercent: null,
            pool: { length: '10', width: '5', depth: '1.5' },
          },
        ],
      },
    }),
  );
  add(
    'swimming-pool-unpriced-finish',
    'Pool whose wall finish the sheet does not list',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '800' },
      siteWorks: {
        civil: [
          {
            item: clinkerPool.name,
            description: null,
            quantity: null,
            completionPercent: null,
            pool: { length: '8', width: '4', depth: '1.4' },
          },
        ],
      },
    }),
  );
  add(
    'two-pools',
    'Two pools with different finishes',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '1500' },
      siteWorks: {
        civil: [
          {
            item: goodPool.name,
            description: null,
            quantity: null,
            completionPercent: null,
            pool: { length: '10', width: '5', depth: '1.5' },
          },
          {
            item: otherPool.name,
            description: null,
            quantity: null,
            completionPercent: null,
            pool: { length: '6', width: '3', depth: '1.2' },
          },
        ],
      },
    }),
  );
  add(
    'gas-station',
    'Fuel station purpose with station works',
    input({
      city: 'Adama',
      purpose: 'GAS STATION',
      propertyType: 'Fuel Stations',
      land: { plotArea: '1500' },
      buildings: [building({ costType: 'Villa', floorArea: '60', builtUpArea: '60' })],
      siteWorks: {
        gasStation: [
          { item: 'Canopy (m2)', quantity: '200', completionPercent: null },
          { item: 'Tanker with a Capacity of 20000', quantity: '3', completionPercent: null },
          {
            item: 'Concrete apron around the pump island (m2)',
            quantity: '150',
            completionPercent: null,
          },
        ],
      },
    }),
  );
  add(
    'coffee-site',
    'Coffee washing site with site works',
    input({
      city: cityOfClass('Outline Cities (G3,G4,G5)', 'G5'),
      purpose: 'COFFEE SITE',
      propertyType: 'Coffee Washing Sites',
      land: { plotArea: '5000' },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '200', builtUpArea: '200' })],
      siteWorks: {
        coffeeSite: [
          { item: 'Cherry Hopper (m2)', quantity: '40', completionPercent: null },
          { item: 'Fermentation and Soak Tank (m2)', quantity: '120', completionPercent: null },
          { item: '2" Galvanized Steel Pipe (GSP) (ml)', quantity: '300', completionPercent: null },
        ],
      },
    }),
  );
  add(
    'factory-and-halls',
    'Factory 7 m, hall above 4 m, three identical stores',
    input({
      city: 'Furi',
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      land: {
        plotArea: '6000',
        latitude: outlineIndustrial.latitude,
        longitude: outlineIndustrial.longitude,
      },
      buildings: [
        building({ costType: 'Factory', floorArea: '1200', builtUpArea: '1200', heightM: '7' }),
        building({ costType: 'MPH above 4m', floorArea: '600', builtUpArea: '600', heightM: '8' }),
        building({ costType: 'Villa', floorArea: '30', builtUpArea: '30', count: '3' }),
      ],
    }),
  );
  add(
    'outline-industrial-zone',
    `Industrial zone in ${outlineIndustrial.city}`,
    input({
      city: outlineIndustrial.city,
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      land: {
        plotArea: '3000',
        latitude: outlineIndustrial.latitude,
        longitude: outlineIndustrial.longitude,
      },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '900', builtUpArea: '900' })],
    }),
  );
  add(
    'addis-industrial-3000',
    'Addis Ababa industrial, 3,000 m²: tier slip',
    input({
      city: 'Addis Ababa',
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      land: { plotArea: '3000' },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '1000', builtUpArea: '1000' })],
    }),
  );
  add(
    'addis-industrial-40000',
    'Addis Ababa industrial, 40,000 m²: above the last tier',
    input({
      city: 'Addis Ababa',
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      land: { plotArea: '40000' },
      buildings: [
        building({ costType: 'Factory', floorArea: '8000', builtUpArea: '8000', heightM: '6' }),
      ],
    }),
  );
  add(
    'addis-residential-27000',
    'Addis Ababa residential, 27,000 m²: slipped branch',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '27000' },
    }),
  );
  add(
    'addis-residential-31000',
    'Addis Ababa residential, 31,000 m²: above the last tier',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '31000' },
    }),
  );
  add(
    'school-regional',
    'School in a regional city: 1.875',
    input({
      city: 'Adama',
      purpose: 'SCHOOL',
      propertyType: 'Specialized commercial property',
      land: { plotArea: '5000' },
      buildings: [building({ costType: '2-5 Storey', floorArea: '1600', builtUpArea: '800' })],
    }),
  );
  add(
    'hospital-other-town',
    'Hospital in another town: 1.725',
    input({
      city: cityOfClass('Outline Cities (G3,G4,G5)', 'G3'),
      purpose: 'HOSPITAL',
      propertyType: 'Specialized commercial property',
      land: { plotArea: '3000' },
      buildings: [building({ costType: '2-5 Storey', floorArea: '1200', builtUpArea: '600' })],
    }),
  );
  add(
    'resort-addis',
    'Resort in Addis Ababa: 1.5',
    input({
      city: 'Addis Ababa',
      purpose: 'RESORT',
      propertyType: 'Specialized commercial property',
      land: { plotArea: '4000' },
    }),
  );
  add(
    'small-industrial-plot',
    'Industrial plot under 1,000 m² outside Addis: 1.64',
    input({
      city: cityOfClass('Outline Cities (G3,G4,G5)', 'G4'),
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      land: { plotArea: '800' },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '300', builtUpArea: '300' })],
    }),
  );
  add(
    'mixed-use',
    'Mixed use in a G2 town',
    input({
      city: cityOfClass('Outline City (G2)'),
      purpose: 'MIXED USE',
      propertyType: 'Commercial Building',
      ratings: MIDDLING,
      buildings: [building({ costType: '2-5 Storey', floorArea: '400', builtUpArea: '200' })],
    }),
  );
  add(
    'neighbourhood-g2',
    'Industrial in a G2 town (neighbourhood row)',
    input({
      city: cityOfClass('Outline City (G2)'),
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      ratings: MIDDLING,
      land: { plotArea: '2000' },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '500', builtUpArea: '500' })],
    }),
  );
  add(
    'neighbourhood-g4',
    'Residential in a G4 town (neighbourhood row)',
    input({
      city: cityOfClass('Outline Cities (G3,G4,G5)', 'G4'),
      ratings: MIDDLING,
    }),
  );
  add(
    'neighbourhood-sheger',
    'Commercial in a Sheger town',
    input({
      city: 'Sebeta',
      purpose: 'COMMERCIAL',
      propertyType: 'Commercial Building',
      ratings: MIDDLING,
      buildings: [building({ costType: 'Villa' })],
    }),
  );
  add(
    'neighbourhood-g1-industrial',
    'Industrial in a G1 city',
    input({
      city: 'Adama',
      purpose: 'INDUSTRIAL',
      propertyType: 'Industrial property',
      ratings: MIDDLING,
      land: { plotArea: '2500' },
      buildings: [building({ costType: 'MPH below 4m', floorArea: '400', builtUpArea: '400' })],
    }),
  );
  add('town-spelling', 'Alemgena: misspelt in the multiplier list', input({ city: 'Alemgena' }));
  add('hossana', 'Hossana: misspelt in the regional list', input({ city: 'Hossana' }));
  add(
    'other-city',
    'Other Cities Not Listed Above',
    input({ city: 'Other Cities Not Listed Above' }),
  );
  add(
    'bar-boundary',
    'Built-up area exactly 12% of the plot',
    input({
      city: 'Adama',
      buildings: [building({ costType: 'Villa', builtUpArea: '48' })],
    }),
  );
  add(
    'vacant-plot',
    'No buildings, half the location value',
    input({ city: 'Adama', buildings: [] }),
  );
  add(
    'progress-villa',
    'Villa 40% built, fence half built',
    input({
      city: 'Adama',
      buildings: [
        building({
          costType: 'Villa',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '40',
        }),
      ],
      siteWorks: {
        civil: [
          {
            item: 'HCB Fence Two Sides Pointed (m2)',
            description: null,
            quantity: '100',
            completionPercent: '50',
            pool: null,
          },
        ],
      },
    }),
  );
  add(
    'progress-mixed',
    'One building complete, one 70% built with its own completions',
    input({
      city: 'Adama',
      land: { plotArea: '1500' },
      buildings: [
        building({
          costType: 'Villa',
          supplementary: [{ item: 'HCB 10cm thick (m2)', quantity: '40', completionPercent: null }],
        }),
        building({
          costType: '2-5 Storey',
          floorArea: '640',
          builtUpArea: '160',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '70',
          components: typical('2-5 Storey', '70').map((c, i) =>
            i === 0 ? { ...c, completionPercent: '100' } : c,
          ),
          supplementary: [{ item: 'Gypsum (m2)', quantity: '200', completionPercent: '30' }],
          defects: [{ code: 7, percent: '40' }],
        }),
      ],
      siteWorks: {
        civil: [
          {
            item: 'HCB Fence Two Sides Pointed (m2)',
            description: null,
            quantity: '160',
            completionPercent: '100',
            pool: null,
          },
          {
            item: 'Masonry Septic Tank',
            description: null,
            quantity: '1',
            completionPercent: '0',
            pool: null,
          },
        ],
      },
    }),
  );
  add(
    'progress-addis-residence',
    'Addis Ababa residence 85% built: sale x completion',
    input({
      city: 'Addis Ababa',
      buildings: [
        building({
          costType: 'Villa',
          floorArea: '200',
          builtUpArea: '160',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '85',
        }),
      ],
    }),
  );
  add(
    'progress-apartment',
    'Apartment unit half built',
    input({
      city: 'Addis Ababa',
      propertyType: 'Apartment',
      floorLevel: 2,
      land: { plotArea: '150' },
      buildings: [
        building({
          costType: 'Apartment',
          floorArea: '150',
          builtUpArea: '150',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '50',
        }),
      ],
    }),
  );
  add(
    'progress-middle-band',
    'Built far enough for the middle staging band',
    input({
      city: 'Adama',
      land: { plotArea: '250' },
      buildings: [
        building({
          costType: '2-5 Storey',
          floorArea: '500',
          builtUpArea: '125',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '90',
        }),
      ],
    }),
  );
  add(
    'golla-bee',
    'The Golla Bee Production PLC estimation, retyped',
    goldenInput(),
    'RE-ESTIMATION',
  );
  add(
    'pool-not-first',
    'A pool below a fence: Excel prices its finishes at nil',
    input({
      city: 'Addis Ababa',
      land: { plotArea: '900' },
      siteWorks: {
        civil: [
          {
            item: 'HCB Fence Two Sides Plastered (m2)',
            description: null,
            quantity: '180',
            completionPercent: null,
            pool: null,
          },
          {
            item: goodPool.name,
            description: null,
            quantity: null,
            completionPercent: null,
            pool: { length: '12', width: '6', depth: '1.6' },
          },
        ],
      },
    }),
  );
  add(
    'both-30-years',
    'Held both ways, 30 years left: whole plot as free hold',
    input({
      city: 'Adama',
      land: {
        holdingRight: 'BOTH',
        freeholdArea: '150',
        leaseRemainingYears: 30,
        leaseTotalYears: 60,
        leaseTotalAmount: '1000000',
        leasePaidAmount: '400000',
      },
    }),
  );
  add(
    'condominium-other-building',
    'Condominium whose building 1 is priced as a villa: no sale value',
    input({
      city: 'Addis Ababa',
      propertyType: 'Condominium',
      floorLevel: 2,
      land: { plotArea: '90' },
      buildings: [building({ costType: 'Villa', floorArea: '90', builtUpArea: '90' })],
    }),
  );
  add(
    'progress-floor-defects',
    'Under construction with floor-finish and other defects',
    input({
      city: 'Adama',
      land: { plotArea: '1200' },
      buildings: [
        building({
          costType: 'Villa',
          defects: [
            { code: 32, percent: '40' },
            { code: 13, percent: '50' },
          ],
        }),
        building({
          costType: '2-5 Storey',
          floorArea: '480',
          builtUpArea: '160',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '55',
          defects: [
            { code: 31, percent: '30' },
            { code: 9, percent: '20' },
          ],
        }),
      ],
    }),
  );
  add(
    'progress-gas-station',
    'Fuel station under construction',
    input({
      city: 'Adama',
      purpose: 'GAS STATION',
      propertyType: 'Fuel Stations',
      land: { plotArea: '1500' },
      buildings: [
        building({
          costType: 'Villa',
          floorArea: '60',
          builtUpArea: '60',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '30',
        }),
      ],
      siteWorks: {
        gasStation: [
          { item: 'Canopy (m2)', quantity: '200', completionPercent: '50' },
          { item: 'Tanker with a Capacity of 20000', quantity: '2', completionPercent: '100' },
        ],
      },
    }),
  );
  add(
    'progress-foreclosure',
    'Foreclosure of a residence 60% built',
    input({
      city: 'Addis Ababa',
      buildings: [
        building({
          costType: 'Villa',
          constructionStatus: 'UNDER_CONSTRUCTION',
          progressPercent: '60',
        }),
      ],
    }),
    'FORECLOSURE',
  );
  return list;
}

// ---------------------------------------------------------------------------
// The cells a valuator would type
// ---------------------------------------------------------------------------

interface Write {
  sheet: string;
  ref: string;
  value: string | number | null;
}

/** The workbook's own spelling of each rating, trailing spaces and all. */
function ratingLabels(template: ReturnType<typeof openWorkbook>): Map<string, string> {
  const grid = template.grid('Location Parameters');
  const labels = new Map<string, string>();
  for (const [row, last] of [
    [1, 9],
    [7, 6],
    [13, 7],
    [39, 7],
    [60, 6],
    [81, 6],
  ] as const) {
    for (let c = 2; c < last; c++) {
      const raw = grid[row - 1]?.[c] ?? '';
      if (raw) labels.set(raw.replace(/\s+/g, ' ').trim().toLowerCase(), raw);
    }
  }
  return labels;
}

/** Progress-sheet rows of the condition defects, by guideline code (its own list, in its own order). */
const PROGRESS_DEFECT_ROW: Record<number, number> = {
  7: 237,
  8: 238,
  9: 239,
  10: 240,
  11: 241,
  13: 243,
  14: 244,
  15: 245,
  17: 247,
  18: 248,
  19: 249,
  20: 250,
  22: 252,
  23: 253,
  24: 254,
  25: 255,
  27: 257,
  28: 258,
  29: 259,
  35: 261,
  36: 262,
  38: 264,
};

const HOLDING_TEXT = {
  FREEHOLD: 'FREE/OLD(ነባር)',
  LEASE: 'LEASE(ሊዝ)',
  BOTH: 'BOTH FREE/OLD(ነባር) & LEASE(ሊዝ)',
} as const;

const fraction = (percent: string | number) => Number(percent) / 100;
const serial = (date: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

function toCells(s: Scenario, labels: Map<string, string>): Write[] {
  const writes: Write[] = [];
  const w = (sheet: string, ref: string, value: string | number | null) =>
    writes.push({ sheet, ref, value });
  const { location, land } = s.input;
  const rating = (text: string) => {
    const raw = labels.get(text.replace(/\s+/g, ' ').trim().toLowerCase());
    if (!raw) throw new Error(`${s.name}: no workbook label for "${text}"`);
    return raw;
  };

  w(HOME, 'E6', serial(s.input.valuationDate));
  w(HOME, 'E16', HOLDING_TEXT[land.holdingRight]);
  w(HOME, 'E18', Number(land.plotArea));
  w(HOME, 'E20', location.purpose);
  w(HOME, 'E22', location.propertyType);
  w(HOME, 'E23', location.floorLevel);
  w(HOME, 'E26', location.city);
  w(HOME, 'E27', land.latitude === null ? null : Number(land.latitude));
  w(HOME, 'F27', land.longitude === null ? null : Number(land.longitude));
  for (let k = 1; k <= 10; k++) {
    const b = s.input.buildings.find((x) => x.buildingNumber === k);
    const row = 5 + k;
    w(HOME, `I${row}`, b ? b.name : 'Building Name');
    w(HOME, `J${row}`, b ? b.costType : 'Select Building Type');
    w(HOME, `K${row}`, b ? Number(b.count) : null);
    w(HOME, `L${row}`, b && b.builtUpArea ? Number(b.builtUpArea) : null);
    w(HOME, `M${row}`, b && b.floorArea ? Number(b.floorArea) : null);
    w(HOME, `P${row}`, b && b.heightM ? Number(b.heightM) : null);
  }

  const progress = s.input.buildings.some((b) => b.constructionStatus === 'UNDER_CONSTRUCTION');
  let newRow = 273;
  let suppRow = 315;
  for (const b of s.input.buildings) {
    const c = block(b.buildingNumber);
    const label = `Building ${b.buildingNumber}`;
    const under = b.constructionStatus === 'UNDER_CONSTRUCTION';
    const completion = (own: string | null) =>
      under ? fraction(own ?? b.progressPercent ?? '0') : 1;
    for (const comp of b.components) {
      w(COMPLETED, `${c.share}${comp.row}`, fraction(comp.sharePercent));
      if (progress)
        w(
          PROGRESS,
          `${c.share}${comp.row}`,
          fraction(comp.sharePercent) * completion(comp.completionPercent),
        );
    }
    b.newComponents.forEach((n, i) => {
      w(COMPLETED, `B${newRow}`, n.category);
      w(COMPLETED, `C${newRow}`, n.description);
      w(COMPLETED, `E${newRow}`, label);
      w(COMPLETED, `F${newRow}`, Number(n.unitRate));
      w(COMPLETED, `${c.share}${202 + i}`, fraction(n.sharePercent));
      if (progress)
        w(
          PROGRESS,
          `${c.share}${202 + i}`,
          fraction(n.sharePercent) * completion(n.completionPercent),
        );
      newRow++;
    });
    b.supplementary.forEach((item, i) => {
      w(COMPLETED, `B${suppRow}`, item.item);
      w(COMPLETED, `E${suppRow}`, label);
      w(COMPLETED, `${c.share}${213 + i}`, Number(item.quantity));
      // The progress sheet links these quantities for building 1 only
      // (C213:C222); for any other building they must be typed again there.
      if (progress && b.buildingNumber > 1)
        w(PROGRESS, `${c.share}${213 + i}`, Number(item.quantity));
      // The progress sheet prices its own copy of the list by completion (C311...).
      if (progress)
        w(
          PROGRESS,
          `C${suppRow - 4}`,
          under && item.completionPercent !== null ? fraction(item.completionPercent) : 1,
        );
      suppRow++;
    });
    for (const d of b.defects) {
      w(COMPLETED, `${c.share}${d.code + 230}`, fraction(d.percent));
      if (progress) {
        // The progress sheet has no row for the floor-finish defects.
        const row = PROGRESS_DEFECT_ROW[d.code];
        if (row) w(PROGRESS, `${c.share}${row}`, fraction(d.percent));
      }
    }
  }

  s.input.siteWorks.civil.forEach((work, i) => {
    w(COMPLETED, `B${333 + i}`, work.item);
    w(COMPLETED, `C${333 + i}`, work.description);
    w(
      COMPLETED,
      `E${333 + i}`,
      work.pool
        ? `${work.pool.length},${work.pool.width},${work.pool.depth}`
        : Number(work.quantity),
    );
    if (progress)
      w(
        PROGRESS,
        `C${329 + i}`,
        work.completionPercent === null ? 1 : fraction(work.completionPercent),
      );
  });
  s.input.siteWorks.gasStation.forEach((work, i) => {
    w(COMPLETED, `B${354 + i}`, work.item);
    w(COMPLETED, `E${354 + i}`, Number(work.quantity));
    if (progress)
      w(
        PROGRESS,
        `C${350 + i}`,
        work.completionPercent === null ? 1 : fraction(work.completionPercent),
      );
  });
  s.input.siteWorks.coffeeSite.forEach((work, i) => {
    w(COMPLETED, `B${375 + i}`, work.item);
    w(COMPLETED, `E${375 + i}`, Number(work.quantity));
    if (progress)
      w(
        PROGRESS,
        `C${371 + i}`,
        work.completionPercent === null ? 1 : fraction(work.completionPercent),
      );
  });

  w(COMPLETED, 'E404', rating(location.utility));
  w(COMPLETED, 'E405', rating(location.neighbourhood));
  w(COMPLETED, 'E406', rating(location.roadQuality));
  w(COMPLETED, 'E407', rating(location.roadWidth));
  w(COMPLETED, 'E408', rating(location.proximity));
  w(COMPLETED, 'E409', rating(location.accessibility));
  w(COMPLETED, 'D416', land.freeholdArea === null ? null : Number(land.freeholdArea));
  w(COMPLETED, 'D417', land.leasePaidAmount === null ? null : Number(land.leasePaidAmount));
  w(COMPLETED, 'D418', land.leaseTotalAmount === null ? null : Number(land.leaseTotalAmount));
  w(COMPLETED, 'D419', land.leaseTotalYears);
  w(COMPLETED, 'D420', land.leaseRemainingYears);
  w(REPORT, 'E65', s.estimationType);
  w(REPORT_PROGRESS, 'E65', s.estimationType);
  return writes;
}

/** Every input the template was saved with, so a scenario starts from an empty form. */
function savedInputs(template: ReturnType<typeof openWorkbook>): { sheet: string; ref: string }[] {
  const clear: { sheet: string; ref: string }[] = [];
  const add = (sheet: string, ref: string) => {
    const v = template.value(sheet, ref);
    if (v !== null && v !== undefined && v !== '') clear.push({ sheet, ref });
  };
  for (const sheet of [COMPLETED, PROGRESS]) {
    for (let k = 1; k <= 12; k++) {
      const { share } = block(k);
      // The progress sheet's defect list is shorter (rows 237-265).
      const defectsTo = sheet === COMPLETED ? 269 : 265;
      for (const [from, to] of [
        [10, 200],
        [202, 211],
        [237, defectsTo],
      ] as const) {
        for (let r = from; r <= to; r++) add(sheet, `${share}${r}`);
      }
      if (sheet === COMPLETED) for (let r = 213; r <= 222; r++) add(sheet, `${share}${r}`);
    }
  }
  for (let r = 273; r <= 312; r++)
    for (const col of ['B', 'C', 'E', 'F']) add(COMPLETED, `${col}${r}`);
  for (const [from, to] of [
    [315, 330],
    [333, 348],
    [354, 369],
    [375, 390],
  ] as const) {
    for (let r = from; r <= to; r++)
      for (const col of ['B', 'C', 'E']) add(COMPLETED, `${col}${r}`);
  }
  for (const [from, to] of [
    [311, 326],
    [329, 344],
    [350, 365],
    [371, 386],
  ] as const) {
    for (let r = from; r <= to; r++) add(PROGRESS, `C${r}`);
  }
  return clear;
}

const READS = [
  { sheet: HOME, range: 'E4:F31' },
  { sheet: COMPLETED, range: 'B5:AJ233' },
  { sheet: COMPLETED, range: 'A330:H420' },
  { sheet: PROGRESS, range: 'B5:AJ233' },
  { sheet: PROGRESS, range: 'A305:H416' },
  { sheet: REPORT, range: 'A20:M145' },
  { sheet: REPORT_PROGRESS, range: 'A20:M150' },
  { sheet: 'LHR with coordinate', range: 'A1:C12' },
  { sheet: 'LHR without coordinate', range: 'A1:C20' },
  { sheet: 'SALE APPROACH ', range: 'A1:J15' },
];

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

/**
 * `record`: also write each scenario's input and the Excel values of the cells
 * it was compared on - a fixture the unit tests check the engine against
 * without Excel.
 */
function compare(specFile: string, resultsFile: string, record: string | null): number {
  const spec = JSON.parse(readFileSync(specFile, 'utf8')) as {
    scenarios: (Scenario & { writes: Write[] })[];
  };
  const results = JSON.parse(readFileSync(resultsFile, 'utf8').replace(/^﻿/, '')) as Record<
    string,
    { error: string | null; values: Record<string, CellValue> }
  >;
  let failing = 0;
  let figures = 0;
  const summary: string[] = [];
  const fixture: {
    name: string;
    about: string;
    input: CivilEngineInput;
    excel: Record<string, CellValue>;
  }[] = [];
  for (const s of spec.scenarios) {
    const result = results[s.name];
    if (!result) {
      summary.push(`NOT RUN    ${s.name}`);
      failing++;
      continue;
    }
    if (result.error) {
      summary.push(`EXCEL FAIL ${s.name}: ${result.error}`);
      failing++;
      continue;
    }
    let output;
    try {
      output = calculateCivil(s.input, PARAMS);
    } catch (error) {
      summary.push(`SYSTEM REFUSED ${s.name}: ${(error as Error).message}`);
      failing++;
      continue;
    }
    const read: Record<string, CellValue> = {};
    const get = (sheet: string, ref: string) => {
      const key = `${sheet}!${ref}`;
      read[key] = result.values[key] ?? null;
      return result.values[key];
    };
    const rows = compareFigures(output, get, {
      civil: s.input.siteWorks.civil.map((_, i) => 333 + i),
      gasStation: s.input.siteWorks.gasStation.map((_, i) => 354 + i),
      coffeeSite: s.input.siteWorks.coffeeSite.map((_, i) => 375 + i),
    });
    figures += rows.length;
    fixture.push({ name: s.name, about: s.about, input: s.input, excel: read });
    const wrong = rows.filter((r) => !agrees(r));
    const finalCell = output.mode === 'PROGRESS' ? `${REPORT_PROGRESS}!K144` : `${REPORT}!K139`;
    const excelFinal = result.values[finalCell];
    summary.push(
      `${wrong.length === 0 ? 'SAME      ' : 'DIFFERENT '} ${s.name.padEnd(34)} ${String(rows.length).padStart(4)} figures  ` +
        `Excel ${typeof excelFinal === 'number' ? excelFinal.toFixed(2) : String(excelFinal)}  system ${output.marketValue}` +
        (wrong.length ? `  (${wrong.length} differ)` : ''),
    );
    if (wrong.length > 0) {
      failing++;
      console.log(`\n=== ${s.name}: ${s.about}`);
      printFigures(wrong, (line) => console.log(line));
    }
  }
  if (record) {
    const recorded = {
      template: 'Version 4.2 Estimation template',
      recalculatedBy: 'Microsoft Excel',
      scenarios: fixture,
    };
    writeFileSync(resolve(record), `${JSON.stringify(recorded, null, 1)}\n`);
    console.log(`Recorded ${fixture.length} scenarios to ${record}`);
  }
  console.log(`\n${summary.join('\n')}`);
  console.log(
    `\n${spec.scenarios.length - failing} of ${spec.scenarios.length} scenarios agree with Excel (${figures} figures compared).`,
  );
  return failing;
}

// ---------------------------------------------------------------------------

const [mode, a, b] = process.argv.slice(2);
if (mode === 'build' && a && b) {
  const template = openWorkbook(resolve(a));
  const labels = ratingLabels(template);
  const clear = savedInputs(template);
  const built = scenarios().map((s) => ({ ...s, clear, writes: toCells(s, labels), reads: READS }));
  writeFileSync(resolve(b), JSON.stringify({ scenarios: built }));
  console.log(
    `${built.length} scenarios written to ${b} (${clear.length} saved inputs cleared in each).`,
  );
} else if (mode === 'compare' && a && b) {
  const args = process.argv.slice(2);
  const record = args.includes('--record') ? args[args.indexOf('--record') + 1]! : null;
  process.exit(compare(resolve(a), resolve(b), record) === 0 ? 0 : 1);
} else {
  console.error(
    'Usage: scenarios.mts build <template.xlsm> <scenarios.json> | compare <scenarios.json> <results.json>',
  );
  process.exit(2);
}
