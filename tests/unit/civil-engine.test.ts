import { describe, expect, it } from 'vitest';
import {
  calculateCivil,
  type CivilEngineInput,
  type CivilEngineOutput,
} from '@/server/domain/valuation/civil-engine';
import { canonicalJson } from '@/server/domain/valuation/calculation';
import { pointInPolygon } from '@/server/domain/valuation/civil/excel';
import {
  EXCEL_FIXES,
  EXCEL_FIXES_KEY,
  type CitiesTable,
  type CostCurvesTable,
  type ExcelFix,
  type Grade,
  type PolygonsTable,
  type SwimmingPoolTable,
} from '@/server/domain/valuation/civil/guideline';
import { selectCivilParameters } from '@/server/domain/valuation/civil/select-parameters';
import { poolCost } from '@/server/domain/valuation/civil/site-works';
import { dec } from '@/lib/money';
import { BusinessRuleError, ConfigurationError } from '@/lib/errors';
import { villa, villaCase } from '../helpers/civil-cases';
import { goldenInput, guidelineParameters, guidelineTable } from '../helpers/guideline';

/**
 * The guideline's rules, one at a time.
 *
 * civil-golden proves the whole calculation against the Excel workbook's own
 * case; these tests take each rule the golden case does not exercise. Expected
 * figures are worked here from the guideline tables by plain arithmetic, or by
 * hand in the comments - never read back from the engine.
 */

const PARAMS = guidelineParameters();
const cities = guidelineTable<CitiesTable>('guideline.cities').cities;
const curves = guidelineTable<CostCurvesTable>('guideline.cost_curves').curves;

const run = (input = villaCase(), fixes: Partial<Record<ExcelFix, boolean>> = {}) =>
  calculateCivil(input, Object.keys(fixes).length > 0 ? guidelineParameters(fixes) : PARAMS);
const n = (value: string) => Number(value);
const factorOf = (output: CivilEngineOutput, key: string) =>
  n(output.land.factors.find((f) => f.key === key)!.factor);

/** The guideline's cost curve: a·x² + b·x + c. */
function curve(type: string, grade: Grade, x: number): number {
  const [a, b, c] = curves[type]![grade];
  return a * x * x + b * x + c;
}

/** The villa's rate per m² before location: foundation 21% of Excellent, structure 10% of Luxury. */
const villaRate = (area: number) =>
  curve('Villa', 'Excellent', area) * 0.21 + curve('Villa', 'Luxury', area) * 0.1;

// ---------------------------------------------------------------------------

describe('a free-hold villa in a regional city', () => {
  const output = run();

  it('prices the land from the city rate, the plot-size tiers and the location factors', () => {
    // Adama, residential: 12,000 x 1.25 for a regional city.
    expect(cities.Adama!.baseRates!.R).toBe(12000);
    expect(output.land.maxRate).toMatchObject({ source: 'CITY_TABLE', zone: null });
    expect(n(output.land.maxRate.value)).toBe(15000);
    // 400 m²: the first 200 in full, the next 200 at 0.9 -> 380 / 400 of the rate.
    expect(n(output.land.tiers.averageRate)).toBe(14250);
    // Every rating is the best, so only the built-up ratio bites: 160 / 400 = 40% -> 0.9.
    expect(factorOf(output, 'bar')).toBe(0.9);
    expect(n(output.land.factorProduct)).toBe(0.9);
    expect(n(output.land.ratePerSqm)).toBe(12825);
    expect(output.land.locationValue).toBe('5130000.00');
    expect(output.land.locationLabel).toBe('RESIDENTIAL-Normal');
  });

  it('prices the building from the cost curves, with 20% added outside Addis Ababa', () => {
    const building = output.buildings[0]!;
    expect(n(building.complete.componentRate)).toBeCloseTo(villaRate(160), 3);
    expect(n(building.locationFactor)).toBe(1.2);
    expect(n(building.complete.areaRate)).toBeCloseTo(villaRate(160) * 1.2, 3);
    expect(n(building.value)).toBeCloseTo(villaRate(160) * 1.2 * 160, 1);
    expect(building.rateBasis).toBe('AREA');
  });

  it('applies the city’s market condition factor to the building, not the land', () => {
    const mcf = cities.Adama!.mcf!.RESIDENTIAL!;
    expect(n(output.cost.factor)).toBe(mcf);
    const development = villaRate(160) * 1.2 * 160;
    // Three times the building is over 80% of the land value, so the land counts in full.
    expect(output.land.staged.rule).toBe('FULL');
    expect(n(output.cost.indicatedValue)).toBeCloseTo(development * mcf + 5_130_000, 1);
    expect(output.marketValue).toBe(output.cost.indicatedValue);
    expect(output.reconciliation.source).toBe('COST_ONLY');
  });

  it('takes the listed foreclosure percentage for residential land', () => {
    expect(output.forcedSale.percent).toBe('75.00');
    expect(n(output.forcedSaleValue)).toBeCloseTo(n(output.marketValue) * 0.75, 1);
  });

  it('adds nothing for location to a building in Addis Ababa', () => {
    const addis = run(villaCase({ location: { city: 'Addis Ababa' } }));
    expect(n(addis.buildings[0]!.locationFactor)).toBe(1);
    expect(n(addis.buildings[0]!.value)).toBeCloseTo(villaRate(160) * 160, 1);
  });
});

// ---------------------------------------------------------------------------

describe('maximum location rate without a zone', () => {
  const vacant = (city: string, purpose: string, plotArea = '400') =>
    run(villaCase({ location: { city, purpose }, land: { plotArea }, buildings: [] })).land.maxRate;

  it.each([
    ['Adama', 'RESIDENTIAL', 'R', 1.25],
    ['Furi', 'INDUSTRIAL', 'I', 1],
    ['Addis Ababa', 'RESIDENTIAL', 'R', 1],
    ['Addis Ababa', 'COMMERCIAL', 'C', 1.305],
    ['Addis Ababa', 'SHOP', 'C', 1],
    ['Other Cities Not Listed Above', 'RESIDENTIAL', 'R', 1.15],
    ['Abomsa', 'MIXED USE', 'I', 1.15],
    ['Abomsa', 'COFFEE SITE', 'I', 1.5625],
    ['Furi', 'COFFEE SITE', 'I', 1.25],
    ['Abomsa', 'GAS STATION', 'I', 1.5],
    ['Addis Ababa', 'SCHOOL', 'I', 1.5],
    ['Adama', 'HOSPITAL', 'I', 1.875],
    ['Abomsa', 'RESORT', 'I', 1.725],
  ] as const)('%s, %s: the %s rate x %d', (city, purpose, rateClass, multiplier) => {
    const rate = vacant(city, purpose);
    expect(n(rate.baseRate)).toBe(cities[city]!.baseRates![rateClass]);
    expect(n(rate.multiplier)).toBe(multiplier);
    expect(n(rate.value)).toBeCloseTo(cities[city]!.baseRates![rateClass] * multiplier, 4);
  });

  it('raises a small industrial plot outside Addis Ababa more than a large one', () => {
    expect(n(vacant('Abomsa', 'INDUSTRIAL', '800').multiplier)).toBe(1.64);
    expect(n(vacant('Abomsa', 'INDUSTRIAL', '1500').multiplier)).toBe(1.25);
    expect(n(vacant('Addis Ababa', 'INDUSTRIAL', '800').multiplier)).toBe(1);
  });

  it('keeps the workbook’s spelling of the surrounding towns (guideline issue 11)', () => {
    // The formula lists "Alemegena" and "Koye Fechie"; the city list has
    // "Alemgena" and "Koye Feche", so neither is treated as surrounding Addis.
    expect(n(vacant('Alemgena', 'RESIDENTIAL').multiplier)).toBe(1.15);
    expect(n(vacant('Koye Feche', 'RESIDENTIAL').multiplier)).toBe(1.15);
    expect(n(vacant('Sebeta', 'RESIDENTIAL').multiplier)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('location zones', () => {
  const polygons = guidelineTable<PolygonsTable>('guideline.location_polygons').polygons;

  /** A point inside the polygon, and the first zone of its city and class that holds it. */
  function pointIn(source: string, propertyClass: string, grade: string) {
    const target = polygons.find(
      (p) => p.source === source && p.propertyClass === propertyClass && p.grade === grade,
    )!;
    const closed = target.points.slice(0, -1);
    const centre: [number, number] = [
      closed.reduce((s, p) => s + p[0], 0) / closed.length,
      closed.reduce((s, p) => s + p[1], 0) / closed.length,
    ];
    const candidates = [
      centre,
      ...closed.map((p): [number, number] => [(p[0] + centre[0]) / 2, (p[1] + centre[1]) / 2]),
    ];
    const point = candidates.find((c) => pointInPolygon(c[0], c[1], target.points) === true)!;
    const first = polygons.find(
      (p) =>
        p.source === source &&
        p.city.toLowerCase() === target.city.toLowerCase() &&
        p.propertyClass.toLowerCase() === propertyClass.toLowerCase() &&
        pointInPolygon(point[0], point[1], p.points) === true,
    )!;
    return { point, zone: first };
  }

  it('prices residential land in an Addis Ababa prime zone, and multiplies its staged value', () => {
    const { point, zone } = pointIn('addis_ababa', 'Residential', 'Prime 1-A');
    const output = run(
      villaCase({
        location: { city: 'Addis Ababa' },
        land: { latitude: String(point[0]), longitude: String(point[1]) },
      }),
    );
    expect(output.land.maxRate.source).toBe('POLYGON');
    expect(output.land.maxRate.zone?.grade).toBe(zone.grade);
    expect(n(output.land.maxRate.value)).toBe(zone.maxRate);
    expect(output.land.locationLabel).toBe(`RESIDENTIAL-${zone.grade}`);
    // REPORT-COMPLETED!K124: RESIDENTIAL-Prime 1-A carries 1.53.
    expect(zone.grade).toBe('Prime 1-A');
    expect(n(output.land.staged.primeMultiplier)).toBe(1.53);
    expect(n(output.land.value)).toBeCloseTo(n(output.land.staged.value) * 1.53, 1);
  });

  it('does not multiply a condominium unit’s land in a prime zone', () => {
    const { point } = pointIn('addis_ababa', 'Residential', 'Prime 1-A');
    const output = run(
      villaCase({
        location: { city: 'Addis Ababa', propertyType: 'Condominium', floorLevel: 2 },
        land: { latitude: String(point[0]), longitude: String(point[1]) },
      }),
    );
    expect(n(output.land.staged.primeMultiplier)).toBe(1);
  });

  it('adjusts a commercial zone’s rate by its grade, and again when staged (issue 10)', () => {
    const { point, zone } = pointIn('addis_ababa', 'Commercial', 'Prime 1-B');
    const output = run(
      villaCase({
        location: {
          city: 'Addis Ababa',
          purpose: 'COMMERCIAL',
          propertyType: 'Commercial Building',
        },
        land: { latitude: String(point[0]), longitude: String(point[1]) },
      }),
    );
    expect(zone.grade).toBe('Prime 1-B');
    // 'LHR with coordinate'!B11: COMMERCIAL-Prime 1-B x 1.21; K124 then x 1.26.
    expect(n(output.land.maxRate.value)).toBeCloseTo(zone.maxRate! * 1.21, 4);
    expect(n(output.land.staged.primeMultiplier)).toBe(1.26);
  });

  it('raises a school’s zone rate by half', () => {
    const { point, zone } = pointIn('outline', 'Industrial', 'Prime');
    const output = run(
      villaCase({
        location: { city: zone.city, purpose: 'SCHOOL', propertyType: 'Commercial Building' },
        land: { latitude: String(point[0]), longitude: String(point[1]) },
        buildings: [],
      }),
    );
    expect(output.land.maxRate.source).toBe('POLYGON');
    expect(n(output.land.maxRate.value)).toBeCloseTo(zone.maxRate! * 1.5, 4);
  });

  it('falls back to the city rate, saying so, when the point is in no zone', () => {
    const output = run(
      villaCase({ location: { city: 'Addis Ababa' }, land: { latitude: '1.0', longitude: '1.0' } }),
    );
    expect(output.land.maxRate.source).toBe('CITY_TABLE');
    expect(output.notes.join(' ')).toMatch(/fall in no residential location zone/);
  });
});

// ---------------------------------------------------------------------------

describe('location factors', () => {
  it('reads a shop’s utility, neighbourhood and proximity from the industrial tables', () => {
    // G404/G405/G408 test the purpose for "Residential" and "Commercial" only.
    const ratings = {
      utility: 'No Utility',
      neighbourhood: 'Normal',
      proximity: 'Out side the city',
    };
    const shop = run(villaCase({ location: { purpose: 'SHOP', ...ratings }, buildings: [] }));
    const commercial = run(
      villaCase({ location: { purpose: 'COMMERCIAL', ...ratings }, buildings: [] }),
    );
    // Adama is Outline City (G1): industrial 0.83 / 0.911 / 0.9453, commercial 0.949 / 0.9375 / 0.85.
    expect(factorOf(shop, 'utility')).toBe(0.83);
    expect(factorOf(shop, 'neighbourhood')).toBe(0.911);
    expect(factorOf(shop, 'proximity')).toBe(0.9453);
    expect(factorOf(commercial, 'utility')).toBe(0.949);
    expect(factorOf(commercial, 'neighbourhood')).toBe(0.9375);
    expect(factorOf(commercial, 'proximity')).toBe(0.85);
  });

  it('reads the road factors by city group', () => {
    const rough = {
      roadQuality: 'Dry Weather Road',
      roadWidth: 'Access Road <= 5m',
      accessibility: 'Beyond 500m',
    };
    const outline = run(villaCase({ location: rough }));
    const addis = run(villaCase({ location: { city: 'Addis Ababa', ...rough } }));
    expect([
      factorOf(outline, 'roadQuality'),
      factorOf(outline, 'roadWidth'),
      factorOf(outline, 'accessibility'),
    ]).toEqual([0.8, 0.9, 0.75]);
    expect([
      factorOf(addis, 'roadQuality'),
      factorOf(addis, 'roadWidth'),
      factorOf(addis, 'accessibility'),
    ]).toEqual([0.94, 0.95, 0.8]);
  });

  it.each([
    [40, 0.75], // 10% of the plot: below 12%
    [48, 0.85], // exactly 12% is no longer "below"
    [96, 0.85], // 24%
    [168, 0.9], // 42%
    [240, 0.95], // 60%
    [260, 1], // 65%
  ])('grades a built-up area of %d m² on 400 m² at %d', (builtUp, factor) => {
    const output = run(villaCase({ buildings: [villa({ builtUpArea: String(builtUp) })] }));
    expect(factorOf(output, 'bar')).toBe(factor);
  });

  it('counts every identical building in the built-up area ratio', () => {
    // Two buildings of 80 m² built-up on 400 m²: 40% -> 0.9.
    const output = run(villaCase({ buildings: [villa({ builtUpArea: '80', count: '2' })] }));
    expect(n(output.land.builtUpAreaRatio)).toBe(0.4);
    expect(factorOf(output, 'bar')).toBe(0.9);
  });

  it('reads the neighbourhood factor as the workbook does, until corrected (issue 1)', () => {
    const golden = goldenInput();
    const asWorkbook = calculateCivil(golden, PARAMS);
    const corrected = calculateCivil(
      golden,
      guidelineParameters({ neighbourhoodExactMatch: true }),
    );
    // Furi is a Sheger City town; the workbook lands on the Outline (G3,G4,G5) row.
    expect(factorOf(asWorkbook, 'neighbourhood')).toBe(0.8175);
    expect(factorOf(corrected, 'neighbourhood')).toBe(0.9195);
    expect(asWorkbook.notes.join(' ')).toMatch(/guideline issue 1/);
    expect(n(corrected.marketValue)).toBeGreaterThan(n(asWorkbook.marketValue));
  });

  it('grades an industrial plot on the residential thresholds, until corrected (issue 2)', () => {
    const golden = goldenInput();
    // Built-up 47.8% of the plot: 0.95 on 12/24/42/60%, 1.0 on 7/14/25/35%.
    expect(factorOf(calculateCivil(golden, PARAMS), 'bar')).toBe(0.95);
    expect(
      factorOf(
        calculateCivil(golden, guidelineParameters({ industrialBarThresholds: true })),
        'bar',
      ),
    ).toBe(1);
  });

  it('lowers a condominium unit’s rate by its floor', () => {
    const unit = (floorLevel: number | null) =>
      run(
        villaCase({ location: { city: 'Addis Ababa', propertyType: 'Condominium', floorLevel } }),
      );
    expect(factorOf(unit(0), 'floorLevel')).toBe(1);
    expect(factorOf(unit(4), 'floorLevel')).toBe(0.9);
    expect(factorOf(unit(6), 'floorLevel')).toBe(0.85);
    expect(factorOf(unit(9), 'floorLevel')).toBe(0.85);
    expect(() => unit(null)).toThrow(/floor level/);
    expect(run().land.factors.some((f) => f.key === 'floorLevel')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('land holding', () => {
  // The baseline villa case has a location rate of exactly 12,825 per m² on 400 m².
  const WHOLE = 400 * 12825;
  const lease = (land: Partial<CivilEngineInput['land']>) =>
    run(villaCase({ land: { holdingRight: 'LEASE', ...land } })).land;

  /** H413's lease branch, worked directly from the workbook formula. */
  function leaseFormula(
    area: number,
    total: number,
    remaining: number,
    amount: number,
    paid: number,
  ) {
    const full = area * 12825;
    const share = remaining / total;
    const net = (full - (amount - paid)) * share;
    const part1 = (net >= amount ? net : paid * share) * (1 - share);
    const discounted = full - (amount - paid) / 1.07 ** remaining;
    const part2 = (discounted <= paid ? paid : discounted) * share;
    return part1 + part2;
  }

  it('values a lease with 20 or more years to run as free hold', () => {
    const land = lease({ leaseRemainingYears: 20 });
    expect(land.holding.basis).toBe('LEASE_AS_FREEHOLD');
    expect(n(land.locationValue)).toBe(WHOLE);
  });

  it('values a shorter lease on its terms', () => {
    const land = lease({
      leaseRemainingYears: 10,
      leaseTotalYears: 50,
      leaseTotalAmount: '1000000',
      leasePaidAmount: '400000',
    });
    // Net of the unpaid 600,000 the land is 4,530,000; a fifth of the term
    // remains, and 906,000 is under the total lease amount, so part 1 is the
    // paid 400,000 x 0.2 x 0.8 = 64,000. Part 2 discounts the unpaid balance
    // over ten years at 7% and takes a fifth: 964,998.09.
    expect(land.holding.basis).toBe('LEASE');
    expect(n(land.holding.lease!.part1)).toBe(64000);
    expect(n(land.holding.lease!.part2)).toBeCloseTo((WHOLE - 600000 / 1.07 ** 10) * 0.2, 2);
    expect(n(land.locationValue)).toBeCloseTo(leaseFormula(400, 50, 10, 1_000_000, 400_000), 2);
    expect(n(land.locationValue)).toBeCloseTo(1028998.09, 1);
  });

  it('takes the earned share of the land where it exceeds the lease amount', () => {
    const land = lease({
      leaseRemainingYears: 15,
      leaseTotalYears: 30,
      leaseTotalAmount: '500000',
      leasePaidAmount: '500000',
    });
    // Fully paid: half the term remains, so part 1 is 5,130,000 x 0.5 x 0.5
    // and part 2 is 5,130,000 x 0.5.
    expect(n(land.holding.lease!.part1)).toBe(WHOLE * 0.25);
    expect(n(land.holding.lease!.part2)).toBe(WHOLE * 0.5);
    expect(n(land.locationValue)).toBe(WHOLE * 0.75);
  });

  it('refuses lease terms that cannot be right', () => {
    const terms = {
      leaseRemainingYears: 10,
      leaseTotalYears: 50,
      leaseTotalAmount: '1000000',
      leasePaidAmount: '400000',
    };
    expect(() => lease({ ...terms, leaseTotalYears: 8 })).toThrow(
      /longer than the total lease period/,
    );
    expect(() => lease({ ...terms, leasePaidAmount: '1200000' })).toThrow(
      /more than the total lease amount/,
    );
    expect(() => lease({ ...terms, leaseTotalYears: null })).toThrow(/total lease period/);
    expect(() => lease({ ...terms, leaseTotalAmount: null })).toThrow(/total lease amount/);
    expect(() => lease({ leaseRemainingYears: null })).toThrow(/remaining lease years/);
  });

  describe('held both free and on lease', () => {
    const both = (remaining: number, fixes = {}) =>
      run(
        villaCase({
          land: {
            holdingRight: 'BOTH',
            freeholdArea: '150',
            leaseRemainingYears: remaining,
            leaseTotalYears: 50,
            leaseTotalAmount: '1000000',
            leasePaidAmount: '400000',
          },
        }),
        fixes,
      );

    it('values the free part in full and the leased part on its terms', () => {
      const land = both(10).land;
      expect(n(land.holding.freeholdValue)).toBe(150 * 12825);
      expect(n(land.holding.leaseValue)).toBeCloseTo(
        leaseFormula(250, 50, 10, 1_000_000, 400_000),
        2,
      );
      expect(n(land.locationValue)).toBeCloseTo(
        150 * 12825 + leaseFormula(250, 50, 10, 1_000_000, 400_000),
        2,
      );
    });

    it('values the whole plot as free hold from 25 years remaining', () => {
      const land = both(25).land;
      expect(n(land.locationValue)).toBe(WHOLE);
      expect(land.holding.lease).toBeNull();
    });

    it('counts the leased part twice between 20 and 24 years, as the workbook does (issue 4)', () => {
      const output = both(22);
      expect(n(output.land.holding.freeholdValue)).toBe(WHOLE);
      expect(n(output.land.locationValue)).toBeCloseTo(
        WHOLE + leaseFormula(250, 50, 22, 1_000_000, 400_000),
        2,
      );
      expect(output.notes.join(' ')).toMatch(/guideline issue 4/);
    });

    it('counts it once when the correction is switched on', () => {
      const land = both(22, { bothHoldingDoubleCount: true }).land;
      expect(n(land.holding.freeholdValue)).toBe(150 * 12825);
      expect(n(land.locationValue)).toBe(WHOLE);
      // Below 20 years the corrected and workbook rules agree.
      expect(both(10, { bothHoldingDoubleCount: true }).land.locationValue).toBe(
        both(10).land.locationValue,
      );
    });

    it('needs the free-hold part of the plot', () => {
      expect(() =>
        run(villaCase({ land: { holdingRight: 'BOTH', leaseRemainingYears: 30 } })),
      ).toThrow(/free-hold part/);
      expect(() =>
        run(
          villaCase({
            land: { holdingRight: 'BOTH', leaseRemainingYears: 30, freeholdArea: '500' },
          }),
        ),
      ).toThrow(/cannot be larger than the plot/);
    });
  });
});

// ---------------------------------------------------------------------------

describe('staging the location value', () => {
  it('takes half for a vacant plot', () => {
    const output = run(villaCase({ buildings: [] }));
    expect(output.land.staged.rule).toBe('HALF');
    expect(n(output.land.value)).toBe(n(output.land.locationValue) / 2);
    expect(output.marketValue).toBe(output.land.value);
  });

  it('takes more as the development grows, up to the whole', () => {
    // A 60 m² villa: 15% built-up -> factor 0.85, land 400 x 14,250 x 0.85 = 4,845,000.
    const output = run(villaCase({ buildings: [villa({ floorArea: '60', builtUpArea: '60' })] }));
    const landValue = 4_845_000;
    const development = villaRate(60) * 1.2 * 60;
    expect(n(output.land.locationValue)).toBe(landValue);
    expect(development * 3).toBeGreaterThan(0.3 * landValue);
    expect(development * 3).toBeLessThan(0.8 * landValue);
    expect(output.land.staged.rule).toBe('PARTIAL');
    // 50% + (3V / LV - 30%) of the land value.
    expect(n(output.land.value)).toBeCloseTo(0.2 * landValue + 3 * development, 1);
    expect(output.notes.join(' ')).toMatch(/of the location value is taken/);
  });

  it('counts fuel station and coffee site works as development', () => {
    const output = run(
      villaCase({
        location: { purpose: 'GAS STATION', propertyType: 'Fuel Stations' },
        buildings: [],
        siteWorks: {
          gasStation: [{ item: 'Canopy (m2)', quantity: '100', completionPercent: null }],
        },
      }),
    );
    // Canopy 16,068.85 per m².
    expect(output.siteWorks.gasStationTotal).toBe('1606885.00');
    expect(output.cost.developmentValue).toBe('1606885.00');
    expect(n(output.cost.afterFactor)).toBeCloseTo(1606885 * cities.Adama!.mcf!['GAS STATION']!, 2);
  });
});

// ---------------------------------------------------------------------------

describe('buildings', () => {
  it('prices a factory on four metres of volume, with 20% for each metre above', () => {
    const factory = villa({
      costType: 'Factory',
      floorArea: '500',
      builtUpArea: '500',
      heightM: '7',
      components: [{ row: 11, sharePercent: '100', completionPercent: null }],
    });
    const output = run(
      villaCase({
        location: { purpose: 'INDUSTRIAL', propertyType: 'Industrial property' },
        land: { plotArea: '2000' },
        buildings: [factory],
      }),
    );
    const building = output.buildings[0]!;
    // Row 11: footing or mat foundation, Luxury, 30%. A factory's curve is read at its floor area.
    const rate = curve('Factory', 'Luxury', 500) * 0.3 * 1.2;
    expect(building.rateBasis).toBe('AREA');
    expect(n(building.costedArea)).toBe(2000);
    expect(n(building.heightFactor)).toBe(1.6);
    expect(n(building.value)).toBeCloseTo(rate * 2000 * 1.6, 1);
  });

  it('prices a low hall on its floor area alone', () => {
    const hall = villa({
      costType: 'MPH below 4m',
      floorArea: '300',
      builtUpArea: '300',
      components: [{ row: 11, sharePercent: '100', completionPercent: null }],
    });
    const building = run(villaCase({ land: { plotArea: '1000' }, buildings: [hall] }))
      .buildings[0]!;
    expect(n(building.costedArea)).toBe(300);
    expect(n(building.heightFactor)).toBe(1);
    expect(n(building.value)).toBeCloseTo(
      curve('MPH below 4m', 'Luxury', 300) * 0.3 * 1.2 * 300,
      1,
    );
  });

  it('needs the height of a hall or factory', () => {
    expect(() =>
      run(
        villaCase({
          buildings: [
            villa({
              costType: 'Factory',
              components: [{ row: 11, sharePercent: '100', completionPercent: null }],
            }),
          ],
        }),
      ),
    ).toThrow(/height/);
  });

  it('multiplies by the number of identical buildings', () => {
    const one = run().buildings[0]!;
    const three = run(villaCase({ land: { plotArea: '2000' }, buildings: [villa({ count: '3' })] }))
      .buildings[0]!;
    expect(n(three.costedArea)).toBe(480);
    expect(n(three.value)).toBeCloseTo(n(one.value) * 3, 1);
  });

  it('weights each component by the share of the building it makes up', () => {
    // Half the structure in RC (row 14, Luxury, 10%), half in RHS (row 16, Excellent, 10%).
    const mixed = villa({
      components: [
        { row: 11, sharePercent: '100', completionPercent: null },
        { row: 14, sharePercent: '50', completionPercent: null },
        { row: 16, sharePercent: '50', completionPercent: null },
      ],
    });
    const building = run(villaCase({ buildings: [mixed] })).buildings[0]!;
    const expected =
      curve('Villa', 'Excellent', 160) * 0.21 +
      curve('Villa', 'Luxury', 160) * 0.1 * 0.5 +
      curve('Villa', 'Excellent', 160) * 0.1 * 0.5;
    expect(n(building.complete.componentRate)).toBeCloseTo(expected, 3);
  });

  it('uses the minimum curve for a Poor-grade component', () => {
    // Row 17: wooden post, Poor, 15%.
    const building = run(
      villaCase({
        buildings: [
          villa({ components: [{ row: 17, sharePercent: '100', completionPercent: null }] }),
        ],
      }),
    ).buildings[0]!;
    expect(building.components[0]).toMatchObject({ name: 'Wooden Post', grade: 'Poor' });
    expect(n(building.complete.componentRate)).toBeCloseTo(
      curve('Villa', 'minimum', 160) * 0.15,
      3,
    );
  });

  it('adds a component the guideline does not list at its price per m²', () => {
    const building = run(
      villaCase({
        buildings: [
          villa({
            newComponents: [
              {
                category: 'Roofing Work',
                description: 'Green roof',
                unitRate: '500',
                sharePercent: '50',
                completionPercent: null,
              },
            ],
          }),
        ],
      }),
    ).buildings[0]!;
    expect(n(building.complete.componentRate)).toBeCloseTo(villaRate(160) + 250, 3);
  });

  it('adds supplementary works after depreciation, at the guideline rate', () => {
    const building = run(
      villaCase({
        buildings: [
          villa({
            defects: [{ code: 17, percent: '100' }],
            supplementary: [
              { item: 'HCB 10cm thick (m2)', quantity: '40', completionPercent: null },
            ],
          }),
        ],
      }),
    ).buildings[0]!;
    // HCB 10 cm: 1,508.865 per m².
    expect(building.complete.supplementaryTotal).toBe('60354.60');
    expect(n(building.value)).toBeCloseTo(n(building.complete.depreciatedCost) + 60354.6, 2);
  });

  describe('depreciation by condition defects', () => {
    const defects = [
      { code: 7, percent: '50' }, // major crack on masonry foundation: villa 4%
      { code: 17, percent: '100' }, // leakage on roof: villa 3.5%
    ];

    it('takes each defect’s rate on the share affected', () => {
      const building = run(villaCase({ buildings: [villa({ defects })] })).buildings[0]!;
      // 4% x 50% + 3.5% x 100% = 5.5%.
      expect(building.depreciationPercent).toBe('5.5000');
      expect(building.defectCategory).toBe('Villa');
      expect(n(building.complete.depreciatedRate)).toBeCloseTo(villaRate(160) * 1.2 * 0.945, 3);
      expect(n(building.complete.depreciation)).toBeCloseTo(villaRate(160) * 1.2 * 160 * 0.055, 1);
    });

    it('reads a hall’s defects from the MPH rates', () => {
      const hall = villa({
        costType: 'MPH below 4m',
        components: [{ row: 11, sharePercent: '100', completionPercent: null }],
        defects,
      });
      const building = run(villaCase({ buildings: [hall] })).buildings[0]!;
      // 9.25% x 50% + 5% x 100% = 9.625%.
      expect(building.defectCategory).toBe('MPH');
      expect(building.depreciationPercent).toBe('9.6250');
    });

    it('reads a multi-storey building’s defects from the villa rates, until corrected (issue 3)', () => {
      const block = villa({
        costType: '2-5 Storey',
        floorArea: '320',
        components: [{ row: 11, sharePercent: '100', completionPercent: null }],
        defects,
      });
      const asWorkbook = run(villaCase({ buildings: [block] }));
      const corrected = run(villaCase({ buildings: [block] }), { multiStoreyDefectRates: true });
      expect(asWorkbook.buildings[0]!.depreciationPercent).toBe('5.5000');
      // 4.5% x 50% + 2.5% x 100% = 4.75%.
      expect(corrected.buildings[0]!.defectCategory).toBe('Multi-Story Building');
      expect(corrected.buildings[0]!.depreciationPercent).toBe('4.7500');
      expect(asWorkbook.notes.join(' ')).toMatch(/guideline issue 3/);
    });
  });
});

// ---------------------------------------------------------------------------

describe('site works', () => {
  const works = (civil: CivilEngineInput['siteWorks']['civil']) =>
    run(villaCase({ siteWorks: { civil } })).siteWorks;

  it('prices plot civil works at quantity x rate', () => {
    const site = works([
      {
        item: 'HCB Fence Two Sides Pointed (m2)',
        description: null,
        quantity: '224',
        completionPercent: null,
        pool: null,
      },
    ]);
    // 1,945.925 per m².
    expect(site.civil[0]!.amount).toBe('435887.20');
    expect(site.civilTotal).toBe('435887.20');
  });

  it('prices a lump-sum item once, whatever quantity is entered', () => {
    const site = works([
      {
        item: 'Residential Properties: Typically 30–60 meters Deep (Lump Sum)',
        description: null,
        quantity: '3',
        completionPercent: null,
        pool: null,
      },
    ]);
    expect(site.civil[0]).toMatchObject({ kind: 'LUMP_SUM', amount: '210000.00' });
  });

  it('prices a swimming pool from its bill of quantities', () => {
    const pool = guidelineTable<SwimmingPoolTable>('guideline.swimming_pool');
    const item = pool.items[0]!;
    // The sheet as the workbook left it: no dimensions entered, total 11,253.39825855.
    expect(poolCost(pool, item, dec(0), dec(0), dec(0)).toNumber()).toBeCloseTo(11253.39825855, 6);

    // A pool 10 x 5 x 1.5 m, each line as 'Swimming pool'!E6:E27 writes it.
    const [L, W, D] = [10, 5, 1.5];
    const r = pool.rates;
    const plan = (L + 2) * (W + 2);
    const deep = plan * (D + 0.2 + 0.25 + 0.6) - plan * 1.5;
    const wall = 2 * (L + W) * 2;
    const subtotal =
      plan * r.siteClearance +
      plan * 1.5 * r.excavationTo150 +
      deep * r.excavation150To300 +
      plan * 0.6 * r.fillBelowHardcore +
      (plan * (D + 0.45) - L * W * (D + 0.45)) * r.fillAroundWall +
      L * W * r.hardcore +
      (plan * 0.2 + plan * 1.5 + deep) * 1.25 * r.cartAway +
      L * W * r.groundSlab +
      wall * r.shearWall +
      (7 * L * W + 110 * 0.2 * wall) * r.reinforcement +
      2 * wall * 1.1 * r.formwork +
      2 * (L + W) * (D + 0.45) * r.waterproofing +
      wall * r.plastering +
      wall * item.wallRate +
      L * W * item.floorRate;
    const site = works([
      {
        item: item.name,
        description: null,
        quantity: null,
        completionPercent: null,
        pool: { length: '10', width: '5', depth: '1.5' },
      },
    ]);
    expect(site.civil[0]!.kind).toBe('POOL');
    expect(n(site.civil[0]!.amount)).toBeCloseTo(subtotal * 1.0261, 1);
  });

  it('refuses work that is not in the guideline’s lists', () => {
    expect(() =>
      works([
        {
          item: 'Gold-plated gate',
          description: null,
          quantity: '1',
          completionPercent: null,
          pool: null,
        },
      ]),
    ).toThrow(/not in the guideline's internal and plot civil works/);
  });
});

// ---------------------------------------------------------------------------

describe('sale approach and reconciliation', () => {
  const addis = (plot: number, floor: number) =>
    run(
      villaCase({
        location: { city: 'Addis Ababa' },
        land: { plotArea: String(plot) },
        buildings: [villa({ floorArea: String(floor), builtUpArea: String(floor) })],
      }),
    );

  it('applies only to residential property in Addis Ababa', () => {
    expect(run().sales.applicable).toBe(false);
    expect(run().sales.reason).toMatch(/Addis Ababa only/);
    expect(
      run(
        villaCase({
          location: {
            city: 'Addis Ababa',
            purpose: 'COMMERCIAL',
            propertyType: 'Commercial Building',
          },
        }),
      ).sales.reason,
    ).toMatch(/residential property only/);
    expect(
      run(villaCase({ location: { city: 'Addis Ababa', propertyType: 'Commercial Building' } }))
        .sales.applicable,
    ).toBe(false);
  });

  it('does not apply to a plot with a hall, a factory or a tall building', () => {
    const hall = villa({
      buildingId: 'b2',
      buildingNumber: 2,
      costType: 'MPH below 4m',
      components: [{ row: 11, sharePercent: '100', completionPercent: null }],
    });
    const output = run(
      villaCase({
        location: { city: 'Addis Ababa' },
        land: { plotArea: '2000' },
        buildings: [villa(), hall],
      }),
    );
    expect(output.sales.applicable).toBe(false);
    expect(output.sales.reason).toMatch(/MPH below 4m/);
  });

  it('values a residential building by the guideline regression', () => {
    const output = addis(400, 160);
    // 160 m² in Addis: cost rate = DRC / floor area, location rate = land value / plot.
    const costRate = villaRate(160);
    const locationRate = 37728 * 0.9;
    const sale =
      -23468801.76 +
      37621.33 * 400 +
      58264.56 * 160 +
      66697.66 * 160 +
      407.9 * costRate +
      254.21 * locationRate;
    expect(output.sales).toMatchObject({ applicable: true, model: 'RESIDENTIAL_BUILDING' });
    expect(n(output.sales.indicatedValue)).toBeCloseTo(sale, 1);
    expect(n(output.sales.indicatedValue)).toBeCloseTo(24637654.48, 0);
  });

  it('weights cost 75 and sale 25 where the sale value is the higher', () => {
    const output = addis(400, 160);
    expect(n(output.sales.indicatedValue)).toBeGreaterThan(n(output.cost.indicatedValue));
    expect(output.reconciliation).toMatchObject({
      source: 'GUIDELINE',
      costWeight: '75.00',
      salesWeight: '25.00',
    });
    expect(n(output.marketValue)).toBeCloseTo(
      0.75 * n(output.cost.indicatedValue) + 0.25 * n(output.sales.indicatedValue),
      1,
    );
    // Addis Ababa, residential: 80%.
    expect(output.forcedSale.percent).toBe('80.00');
  });

  it('takes the sale value alone where it is below the cost value (issue 9)', () => {
    const output = addis(150, 60);
    expect(n(output.sales.indicatedValue)).toBeLessThan(n(output.cost.indicatedValue));
    expect(output.reconciliation).toMatchObject({ costWeight: '0.00', salesWeight: '100.00' });
    expect(output.marketValue).toBe(output.sales.indicatedValue);
    expect(output.notes.join(' ')).toMatch(/guideline issue 9/);
  });

  it('falls back to the cost approach where the regression gives no value', () => {
    const output = addis(120, 40);
    expect(output.sales.applicable).toBe(false);
    expect(output.reconciliation.source).toBe('COST_ONLY');
    expect(output.marketValue).toBe(output.cost.indicatedValue);
    expect(output.notes.join(' ')).toMatch(/regression gives/);
  });

  it('weights 60/40 in a prime zone', () => {
    const polygons = guidelineTable<PolygonsTable>('guideline.location_polygons').polygons;
    const zone = polygons.find(
      (p) =>
        p.source === 'addis_ababa' && p.propertyClass === 'Residential' && p.grade === 'Prime 1-A',
    )!;
    const inside = zone.points.slice(0, -1);
    const centre = [
      inside.reduce((s, p) => s + p[0], 0) / inside.length,
      inside.reduce((s, p) => s + p[1], 0) / inside.length,
    ];
    const point = [
      centre,
      ...inside.map((p) => [(p[0] + centre[0]!) / 2, (p[1] + centre[1]!) / 2]),
    ].find((c) => pointInPolygon(c[0]!, c[1]!, zone.points) === true)!;
    const output = run(
      villaCase({
        location: { city: 'Addis Ababa' },
        land: { plotArea: '1000', latitude: String(point[0]), longitude: String(point[1]) },
        buildings: [villa({ floorArea: '400', builtUpArea: '200' })],
      }),
    );
    expect(output.sales.applicable).toBe(true);
    if (n(output.sales.indicatedValue) >= n(output.cost.indicatedValue)) {
      expect(output.reconciliation).toMatchObject({ costWeight: '60.00', salesWeight: '40.00' });
    } else {
      expect(output.reconciliation).toMatchObject({ costWeight: '0.00', salesWeight: '100.00' });
    }
  });

  it('values a condominium unit by the unit regression, and an apartment 25% above it', () => {
    const unit = (propertyType: 'Condominium' | 'Apartment', floorArea: string) =>
      run(
        villaCase({
          location: { city: 'Addis Ababa', propertyType, floorLevel: 3 },
          land: { plotArea: '80' },
          buildings: [
            villa({
              costType: propertyType,
              floorArea,
              builtUpArea: floorArea,
              components: [{ row: 11, sharePercent: '100', completionPercent: null }],
            }),
          ],
        }),
      );
    const condo = unit('Condominium', '80');
    expect(condo.sales.model).toBe('CONDOMINIUM');
    const v = condo.sales.variables!;
    const regression =
      -6099230.12139443 +
      92282.265872967 * 80 +
      45.019567647 * n(v.costRate) +
      115.325464132 * n(v.locationRate) -
      32756.23454 * 3;
    expect(n(condo.sales.valueAtCompletion)).toBeCloseTo(regression, 0);
    expect(condo.reconciliation.source).toBe('GUIDELINE');

    const apartment = unit('Apartment', '80');
    const av = apartment.sales.variables!;
    const apartmentRegression =
      -6099230.12139443 +
      92282.265872967 * 80 +
      45.019567647 * n(av.costRate) +
      115.325464132 * n(av.locationRate) -
      32756.23454 * 3;
    expect(n(apartment.sales.valueAtCompletion)).toBeCloseTo(apartmentRegression * 1.25, 0);

    // Under 25 m² and under 3,000,000: floor area x (cost rate + location rate) x 1.75.
    const studio = unit('Condominium', '20');
    const sv = studio.sales.variables!;
    expect(n(studio.sales.valueAtCompletion)).toBeCloseTo(
      20 * (n(sv.costRate) + n(sv.locationRate)) * 1.75,
      0,
    );
  });

  it('needs building 1 to be priced as the unit for a condominium', () => {
    const output = run(
      villaCase({ location: { city: 'Addis Ababa', propertyType: 'Condominium', floorLevel: 1 } }),
    );
    expect(output.sales.applicable).toBe(false);
    expect(output.sales.reason).toMatch(/building 1 to be priced as a Condominium/);
  });

  it('lets the valuator override the weights, with a reason', () => {
    const input = villaCase({
      location: { city: 'Addis Ababa' },
      reconciliation: {
        costWeight: '50',
        salesWeight: '50',
        rationale: 'Thin sales evidence in this sub-city.',
      },
    });
    const output = run(input);
    expect(output.reconciliation).toMatchObject({ source: 'OVERRIDE', costWeight: '50.00' });
    expect(n(output.marketValue)).toBeCloseTo(
      (n(output.cost.indicatedValue) + n(output.sales.indicatedValue)) / 2,
      1,
    );
    expect(() =>
      run({ ...input, reconciliation: { costWeight: '50', salesWeight: '50', rationale: 'no' } }),
    ).toThrow(/Explain why/);
    expect(() =>
      run({
        ...input,
        reconciliation: { costWeight: '70', salesWeight: '50', rationale: 'A long enough reason.' },
      }),
    ).toThrow(/total exactly 100/);
  });
});

// ---------------------------------------------------------------------------

describe('forced-sale value', () => {
  const percent = (city: string, purpose: string) =>
    run(villaCase({ location: { city, purpose }, buildings: [] })).forcedSale.percent;

  it('takes the city’s percentage for residential, commercial and shop land only', () => {
    expect(percent('Addis Ababa', 'RESIDENTIAL')).toBe('80.00');
    expect(percent('Addis Ababa', 'SHOP')).toBe('80.00');
    expect(percent('Adama', 'COMMERCIAL')).toBe('75.00');
    expect(percent('Addis Ababa', 'HOTEL')).toBe('70.00');
    expect(percent('Furi', 'INDUSTRIAL')).toBe('70.00');
    expect(percent('Abomsa', 'RESIDENTIAL')).toBe('70.00');
  });

  it('lets the valuator override it, with a reason', () => {
    const output = run(
      villaCase({ forcedSale: { percent: '60', reason: 'Disputed access road to the plot.' } }),
    );
    expect(output.forcedSale).toMatchObject({ percent: '60.00', isOverridden: true });
    expect(n(output.forcedSaleValue)).toBeCloseTo(n(output.marketValue) * 0.6, 1);
    expect(() => run(villaCase({ forcedSale: { percent: '60', reason: 'short' } }))).toThrow(
      BusinessRuleError,
    );
  });
});

// ---------------------------------------------------------------------------

describe('a property under construction', () => {
  const building = villa({ constructionStatus: 'UNDER_CONSTRUCTION', progressPercent: '40' });
  const input = villaCase({
    buildings: [building],
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
  });
  const output = run(input);
  const complete = villaRate(160) * 1.2 * 160;
  const fence = 194592.5;
  const mcf = cities.Adama!.mcf!.RESIDENTIAL!;

  it('values each building and work as far as it is built', () => {
    expect(output.mode).toBe('PROGRESS');
    expect(n(output.buildings[0]!.complete.value)).toBeCloseTo(complete, 1);
    expect(n(output.buildings[0]!.value)).toBeCloseTo(complete * 0.4, 1);
    expect(output.siteWorks.civil[0]).toMatchObject({
      amount: '194592.50',
      currentAmount: '97296.25',
    });
    expect(n(output.progress!.developmentAtCurrentStage)).toBeCloseTo(
      complete * 0.4 + fence / 2,
      1,
    );
    expect(n(output.progress!.completionPercent)).toBeCloseTo(
      ((complete * 0.4 + fence / 2) / (complete + fence)) * 100,
      2,
    );
  });

  it('stages the location value by the progress rule, less 10% below 80% complete', () => {
    const current = complete * 0.4 + fence / 2;
    const landValue = 5_130_000;
    // Development is under 30% of the land value: half of it, x 0.9.
    expect(current).toBeLessThan(0.3 * landValue);
    expect(output.land.staged.rule).toBe('HALF');
    expect(n(output.land.staged.progressFactor)).toBe(0.9);
    expect(n(output.land.value)).toBeCloseTo(landValue * 0.5 * 0.9, 1);
    expect(n(output.cost.indicatedValue)).toBeCloseTo(current * mcf + landValue * 0.45, 1);
    expect(n(output.progress!.valueAtCompletion)).toBeCloseTo(
      (complete + fence) * mcf + landValue * 0.45,
      1,
    );
    expect(output.marketValue).toBe(output.cost.indicatedValue);
  });

  it('adds the development to a fifth of the land in the middle band, until corrected (issue 8)', () => {
    const further = villaCase({
      buildings: [villa({ constructionStatus: 'UNDER_CONSTRUCTION', progressPercent: '90' })],
    });
    const asWorkbook = run(further);
    const current = complete * 0.9;
    expect(current).toBeGreaterThan(0.3 * 5_130_000);
    expect(current).toBeLessThan(0.8 * 5_130_000);
    // 90% complete, so no 10% reduction.
    expect(n(asWorkbook.land.value)).toBeCloseTo(current + 0.2 * 5_130_000, 1);
    expect(asWorkbook.notes.join(' ')).toMatch(/guideline issue 8/);

    const corrected = run(further, { progressLocationValue: true });
    // The completed-report rule: three times the development is over 80% of the land.
    expect(corrected.land.staged.rule).toBe('FULL');
    expect(n(corrected.land.value)).toBe(5_130_000);
  });

  it('takes a component’s own completion over the registered one', () => {
    const detailed = villa({
      constructionStatus: 'UNDER_CONSTRUCTION',
      progressPercent: '40',
      components: [
        { row: 11, sharePercent: '100', completionPercent: '100' },
        { row: 14, sharePercent: '100', completionPercent: null },
      ],
    });
    const result = run(villaCase({ buildings: [detailed] })).buildings[0]!;
    const expected =
      curve('Villa', 'Excellent', 160) * 0.21 * 1 + curve('Villa', 'Luxury', 160) * 0.1 * 0.4;
    expect(n(result.current.componentRate)).toBeCloseTo(expected, 3);
  });

  it('scales the sale value of a residential building by its completion', () => {
    const addis = run(
      villaCase({
        location: { city: 'Addis Ababa' },
        buildings: [villa({ constructionStatus: 'UNDER_CONSTRUCTION', progressPercent: '80' })],
      }),
    );
    expect(n(addis.sales.indicatedValue)).toBeCloseTo(n(addis.sales.valueAtCompletion) * 0.8, 1);
    // Sale at this stage is above the cost value, so 75/25; below it, cost alone.
    const weights = [addis.reconciliation.costWeight, addis.reconciliation.salesWeight];
    expect(weights).toEqual(
      n(addis.sales.indicatedValue) < n(addis.cost.indicatedValue)
        ? ['100.00', '0.00']
        : ['75.00', '25.00'],
    );
  });
});

// ---------------------------------------------------------------------------

describe('what the engine refuses', () => {
  it.each([
    ['no city', villaCase({ location: { city: '' } }), /Choose the city/],
    [
      'a city the guideline does not list',
      villaCase({ location: { city: 'Atlantis' } }),
      /not a city or town/,
    ],
    ['a town with no location class', villaCase({ location: { city: 'Daleti' } }), /no class/],
    ['no land purpose', villaCase({ location: { purpose: '' } }), /permitted land purpose/],
    [
      'an unknown property type',
      villaCase({ location: { propertyType: 'Castle' } }),
      /not a property type/,
    ],
    ['a missing rating', villaCase({ location: { utility: '' } }), /utility/],
    [
      'an unknown rating',
      villaCase({ location: { roadWidth: 'Wide' } }),
      /not one of the guideline's ratings/,
    ],
    ['no plot area', villaCase({ land: { plotArea: null } }), /plot area is missing/],
    [
      'a building with no type',
      villaCase({ buildings: [villa({ costType: '' })] }),
      /choose its building type/,
    ],
    [
      'a building with no floor area',
      villaCase({ buildings: [villa({ floorArea: null })] }),
      /gross/,
    ],
    [
      'a building with no components',
      villaCase({ buildings: [villa({ components: [] })] }),
      /select the components/,
    ],
    [
      'a component of another type',
      villaCase({
        buildings: [
          villa({ components: [{ row: 9999, sharePercent: '100', completionPercent: null }] }),
        ],
      }),
      /not in the guideline's Villa list/,
    ],
    [
      'a component entered twice',
      villaCase({
        buildings: [
          villa({
            components: [
              { row: 11, sharePercent: '50', completionPercent: null },
              { row: 11, sharePercent: '50', completionPercent: null },
            ],
          }),
        ],
      }),
      /entered twice/,
    ],
    [
      'a share over 100%',
      villaCase({
        buildings: [
          villa({ components: [{ row: 11, sharePercent: '120', completionPercent: null }] }),
        ],
      }),
      /cannot exceed 100%/,
    ],
  ] as const)('%s', (_name, input, message) => {
    expect(() => run(input)).toThrow(message);
    expect(() => run(input)).toThrow(BusinessRuleError);
  });

  it('says so when the parameter set has no guideline tables', () => {
    const empty = { setCode: 'OLD', setVersion: 1, values: {}, tables: {} };
    expect(() => calculateCivil(villaCase(), empty)).toThrow(ConfigurationError);
    expect(() => calculateCivil(villaCase(), empty)).toThrow(/guideline migration/);
  });

  it('notes components that add up to more than the whole building', () => {
    const output = run(
      villaCase({
        buildings: [
          villa({
            components: [
              { row: 11, sharePercent: '80', completionPercent: null },
              { row: 12, sharePercent: '80', completionPercent: null },
            ],
          }),
        ],
      }),
    );
    expect(output.notes.join(' ')).toMatch(/add up to 160.0000% of the building/);
  });
});

// ---------------------------------------------------------------------------

describe('the parameters a run keeps', () => {
  const polygons = guidelineTable<PolygonsTable>('guideline.location_polygons').polygons;
  const addisPoint = polygons.find(
    (p) => p.source === 'addis_ababa' && p.propertyClass === 'Residential',
  )!.points[0]!;
  const cases = {
    golden: goldenInput(),
    villa: villaCase(),
    'Addis Ababa with coordinates': villaCase({
      location: { city: 'Addis Ababa' },
      land: { latitude: String(addisPoint[0] + 0.0005), longitude: String(addisPoint[1] + 0.0005) },
      siteWorks: {
        civil: [
          {
            item: 'Masonry Septic Tank',
            description: null,
            quantity: '1',
            completionPercent: null,
            pool: null,
          },
        ],
        gasStation: [{ item: 'Canopy (m2)', quantity: '10', completionPercent: null }],
        coffeeSite: [{ item: 'Cherry Hopper (m2)', quantity: '5', completionPercent: null }],
      },
    }),
  };

  it.each(Object.entries(cases))(
    'gives the same output on the cut-down set: %s',
    (_name, input) => {
      const selected = selectCivilParameters(PARAMS, input);
      expect(canonicalJson(calculateCivil(input, selected))).toBe(
        canonicalJson(calculateCivil(input, PARAMS)),
      );
      // And a stored snapshot survives a JSON round trip, as it does in the database.
      const stored = JSON.parse(JSON.stringify(selected)) as typeof selected;
      expect(canonicalJson(calculateCivil(input, stored))).toBe(
        canonicalJson(calculateCivil(input, PARAMS)),
      );
    },
  );

  it('keeps a small part of the guideline', () => {
    const full = JSON.stringify(PARAMS).length;
    const selected = JSON.stringify(selectCivilParameters(PARAMS, cases.golden)).length;
    expect(selected).toBeLessThan(full / 10);
  });

  it('still refuses what the full set refuses', () => {
    const input = villaCase({ location: { city: 'Atlantis' } });
    expect(() => calculateCivil(input, selectCivilParameters(PARAMS, input))).toThrow(
      /not a city or town/,
    );
  });
});

describe('the workbook corrections', () => {
  it('are all off as published, and are the switches the engine reads', () => {
    const published = guidelineTable<Record<string, boolean>>(EXCEL_FIXES_KEY);
    expect(Object.keys(published).sort()).toEqual(Object.keys(EXCEL_FIXES).sort());
    expect(Object.values(published).every((on) => on === false)).toBe(true);
  });

  it('are recorded on the output', () => {
    expect(run().guideline).toEqual({
      version: 'v4.2',
      fixes: Object.fromEntries(Object.keys(EXCEL_FIXES).map((k) => [k, false])),
    });
    expect(run(villaCase(), { addisTierFormula: true }).guideline.fixes.addisTierFormula).toBe(
      true,
    );
  });

  it('change an Addis Ababa industrial land rate above 2,000 m² (issue 5)', () => {
    const input = villaCase({
      location: { city: 'Addis Ababa', purpose: 'INDUSTRIAL', propertyType: 'Industrial property' },
      land: { plotArea: '3000' },
      buildings: [],
    });
    const asWorkbook = run(input);
    const corrected = run(input, { addisTierFormula: true });
    // 500 + 500 x .95 + 500 x .8 + 500 x .8, then 1,000 m² at .8 (workbook) or .5 (corrected).
    expect(n(asWorkbook.land.tiers.averageRate)).toBeCloseTo(
      (26409.6 * (500 + 475 + 400 + 400 + 800)) / 3000,
      3,
    );
    expect(n(corrected.land.tiers.averageRate)).toBeCloseTo(
      (26409.6 * (500 + 475 + 400 + 400 + 500)) / 3000,
      3,
    );
    expect(asWorkbook.notes.join(' ')).toMatch(/guideline issue 5/);
  });
});
