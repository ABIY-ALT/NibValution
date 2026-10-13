import { describe, expect, it } from 'vitest';
import { civilWorksheetSchema } from '@/lib/validation/valuation';
import { civilGuide } from '@/server/domain/valuation/civil/guide';
import {
  blankBuilding,
  describeIssue,
  initialState,
  prescribedForcedSalePercent,
  toWorksheet,
  type WorksheetState,
} from '@/components/valuation/civil-worksheet-state';
import { BEST_RATINGS } from '../helpers/civil-cases';
import { guidelineParameters } from '../helpers/guideline';

/**
 * The civil worksheet between the form and the server: what the valuator typed
 * becomes the request the schema accepts, and a stored worksheet fills the form
 * back in exactly.
 */

const guide = civilGuide(guidelineParameters().tables)!;
const BUILDING = '2f1c9f0e-7b1a-4a53-9d3e-1c2b3a4d5e6f';

function filled(): WorksheetState {
  const state = initialState(null, [BUILDING], '2026-09-01');
  return {
    ...state,
    location: {
      city: 'Adama',
      purpose: 'RESIDENTIAL',
      propertyType: 'Residential Building',
      floorLevel: '',
      ...BEST_RATINGS,
    },
    buildings: {
      [BUILDING]: {
        ...blankBuilding(),
        costType: 'Villa',
        components: {
          '14': { share: '85', completion: '' },
          '11': { share: '100', completion: '' },
          // Typed into, then cleared: not part of the building.
          '12': { share: ' ', completion: '' },
        },
        defects: { '17': '50', '7': '' },
        supplementary: [{ item: 'HCB 10cm thick (m2)', quantity: '40', completion: '' }],
      },
    },
    civil: [
      {
        item: 'Masonry Septic Tank',
        description: '',
        quantity: '1',
        completion: '',
        length: '',
        width: '',
        depth: '',
      },
      {
        item: guide.poolItems[0]!,
        description: 'Back garden',
        quantity: '',
        completion: '',
        length: '10',
        width: '5',
        depth: '1.5',
      },
    ],
  };
}

describe('the guide the form is built from', () => {
  it('lists the guideline’s choices', () => {
    expect(guide.version).toBe('v4.2');
    expect(guide.purposes).toHaveLength(11);
    expect(guide.cities[0]!.name).toBe('Addis Ababa');
    expect(guide.buildingTypes.map((t) => t.name)).toEqual([
      'Villa',
      'MPH above 4m',
      'Factory',
      'MPH below 4m',
      'Apartment',
      'Condominium',
      '2-5 Storey',
      '6-10 Storey',
      '11 storey & above',
    ]);
    expect(guide.buildingTypes.filter((t) => t.needsHeight).map((t) => t.name)).toEqual([
      'MPH above 4m',
      'Factory',
    ]);
    expect(guide.floorLevelTypes).toEqual(['Condominium', 'Apartment']);
    expect(guide.ratings.roadQuality).toHaveLength(7);
    expect(guide.remarks.length).toBeGreaterThan(40);
  });

  it('leaves out a town whose location factors cannot be read', () => {
    // Daleti has land rates and an MCF but no class in the location parameters.
    expect(guide.cities.some((c) => c.name === 'Daleti')).toBe(false);
    expect(guide.cities).toHaveLength(328);
  });

  it('is absent where the parameter set has no guideline tables', () => {
    expect(civilGuide({})).toBeNull();
  });

  it('gives the forced-sale percentage for a city and purpose', () => {
    expect(prescribedForcedSalePercent(guide, 'Addis Ababa', 'RESIDENTIAL')).toBe(80);
    expect(prescribedForcedSalePercent(guide, 'Adama', 'SHOP')).toBe(75);
    expect(prescribedForcedSalePercent(guide, 'Addis Ababa', 'INDUSTRIAL')).toBe(70);
    expect(prescribedForcedSalePercent(guide, 'Abomsa', 'RESIDENTIAL')).toBe(70);
    expect(prescribedForcedSalePercent(guide, '', '')).toBe(70);
  });
});

describe('the worksheet a form submits', () => {
  it('is accepted by the server’s schema, blanks becoming absent values', () => {
    const parsed = civilWorksheetSchema.parse(toWorksheet(filled(), [BUILDING], guide));
    expect(parsed.location.floorLevel).toBeNull();
    expect(parsed.lease).toEqual({
      totalYears: null,
      totalAmount: null,
      paidAmount: null,
      freeholdArea: null,
    });
    const building = parsed.buildings[0]!;
    expect(building.heightM).toBeNull();
    // Components in catalogue order; the cleared row and the blank defect are dropped.
    expect(building.components).toEqual([
      { row: 11, sharePercent: '100', completionPercent: null },
      { row: 14, sharePercent: '85', completionPercent: null },
    ]);
    expect(building.defects).toEqual([{ code: 17, percent: '50' }]);
    expect(building.supplementary).toEqual([
      { item: 'HCB 10cm thick (m2)', quantity: '40', completionPercent: null },
    ]);
  });

  it('sends a pool its size and other works none', () => {
    const parsed = civilWorksheetSchema.parse(toWorksheet(filled(), [BUILDING], guide));
    expect(parsed.siteWorks.civil[0]).toMatchObject({
      pool: null,
      quantity: '1',
      description: null,
    });
    expect(parsed.siteWorks.civil[1]).toMatchObject({
      quantity: null,
      pool: { length: '10', width: '5', depth: '1.5' },
    });
  });

  it('fills the form back in from a stored worksheet', () => {
    const stored = civilWorksheetSchema.parse(toWorksheet(filled(), [BUILDING], guide));
    const reopened = initialState(stored, [BUILDING], '2026-10-01');
    expect(civilWorksheetSchema.parse(toWorksheet(reopened, [BUILDING], guide))).toEqual(stored);
    expect(reopened.valuationDate).toBe('2026-09-01');
  });

  it('starts afresh from a worksheet of the earlier formula, keeping its date and remarks', () => {
    const earlier = {
      valuationDate: '2026-08-15',
      landRatePerSqm: '20000',
      buildings: [{ buildingId: BUILDING, unitRate: '15000', constructionType: 'RCC_FRAME' }],
      externalWorks: [],
      remarks: 'Valued on site.',
    };
    const state = initialState(earlier, [BUILDING], '2026-10-01');
    expect(state.valuationDate).toBe('2026-08-15');
    expect(state.remarks).toBe('Valued on site.');
    expect(state.location.city).toBe('');
    expect(state.buildings[BUILDING]).toEqual(blankBuilding());
  });

  it('gives a building registered since the last calculation a blank entry', () => {
    const stored = civilWorksheetSchema.parse(toWorksheet(filled(), [BUILDING], guide));
    const added = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
    const state = initialState(stored, [BUILDING, added], '2026-10-01');
    expect(state.buildings[added]).toEqual(blankBuilding());
    expect(state.buildings[BUILDING]!.costType).toBe('Villa');
  });
});

describe('what the schema refuses', () => {
  const submit = (change: (state: WorksheetState) => void) => {
    const state = filled();
    change(state);
    return civilWorksheetSchema.safeParse(toWorksheet(state, [BUILDING], guide));
  };
  const messages = (result: ReturnType<typeof submit>) =>
    result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

  it.each([
    ['30', true],
    ['0', true],
    ['100', true],
    ['12.5', true],
    ['0.3333', true],
    ['100.01', false],
    ['-5', false],
    ['thirty', false],
    ['1e2', false],
    ['12.34567', false],
  ])('a share of "%s": %s', (share, accepted) => {
    const result = submit((s) => {
      s.buildings[BUILDING]!.components['11'] = { share, completion: '' };
    });
    expect(result.success).toBe(accepted);
  });

  it('names what is missing', () => {
    const result = submit((s) => {
      s.location.city = '';
      s.location.utility = '';
      s.buildings[BUILDING]!.costType = '';
      s.gasStation = [{ item: '', quantity: '', completion: '' }];
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        'location.city: Choose the city or town.',
        'location.utility: Rate the utility.',
        'buildings.0.costType: Choose the building type.',
        'siteWorks.gasStation.0.item: Choose the work.',
      ]),
    );
  });

  it('refuses a floor level that is not a whole number', () => {
    expect(submit((s) => void (s.location.floorLevel = '2.5')).success).toBe(false);
    expect(submit((s) => void (s.location.floorLevel = '3')).success).toBe(true);
  });

  it('says which building or work an issue belongs to', () => {
    expect(
      describeIssue(
        'worksheet.buildings.1.components.0.sharePercent',
        'Share cannot exceed 100%.',
        [1, 4],
      ),
    ).toBe('Building 4: Share cannot exceed 100%.');
    expect(
      describeIssue('worksheet.siteWorks.civil.2.quantity', 'Quantity must be a number.', [1]),
    ).toBe('Plot civil work 3: Quantity must be a number.');
    expect(describeIssue('worksheet.location.city', 'Choose the city or town.', [1])).toBe(
      'Choose the city or town.',
    );
  });
});
