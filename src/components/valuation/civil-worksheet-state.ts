import type { CivilGuide } from '@/server/domain/valuation/civil/guide';
import type { CivilWorksheet } from '@/lib/validation/valuation';

/**
 * The civil worksheet as the form holds it: every field a string, as typed,
 * and the conversion to and from the request the server validates.
 *
 * Kept free of React so the mapping can be reasoned about (and tested) on its
 * own: what the valuator typed is what is sent, with nothing derived here that
 * the server does not derive again.
 */

export interface ComponentEntry {
  share: string;
  completion: string;
}

export interface NewComponentEntry {
  category: string;
  description: string;
  unitRate: string;
  share: string;
  completion: string;
}

export interface QuantityEntry {
  item: string;
  quantity: string;
  completion: string;
}

export interface CivilWorkEntry extends QuantityEntry {
  description: string;
  length: string;
  width: string;
  depth: string;
}

export interface BuildingState {
  costType: string;
  count: string;
  heightM: string;
  /** Selected components by catalogue row; a blank share means not selected. */
  components: Record<string, ComponentEntry>;
  newComponents: NewComponentEntry[];
  /** Affected share by defect code. */
  defects: Record<string, string>;
  supplementary: QuantityEntry[];
}

export interface WorksheetState {
  valuationDate: string;
  location: {
    city: string;
    purpose: string;
    propertyType: string;
    floorLevel: string;
    utility: string;
    neighbourhood: string;
    roadQuality: string;
    roadWidth: string;
    proximity: string;
    accessibility: string;
  };
  lease: { totalYears: string; totalAmount: string; paidAmount: string; freeholdArea: string };
  buildings: Record<string, BuildingState>;
  civil: CivilWorkEntry[];
  gasStation: QuantityEntry[];
  coffeeSite: QuantityEntry[];
  reconciliation: { override: boolean; costWeight: string; salesWeight: string; rationale: string };
  forcedSale: { override: boolean; percent: string; reason: string };
  remarks: string;
}

const text = (v: string | number | null | undefined) =>
  v === null || v === undefined ? '' : String(v);

export const blankBuilding = (): BuildingState => ({
  costType: '',
  count: '1',
  heightM: '',
  components: {},
  newComponents: [],
  defects: {},
  supplementary: [],
});

export const blankQuantity = (): QuantityEntry => ({ item: '', quantity: '', completion: '' });

export const blankCivilWork = (): CivilWorkEntry => ({
  ...blankQuantity(),
  description: '',
  length: '',
  width: '',
  depth: '',
});

/**
 * Whether a stored worksheet is one this form wrote. A case calculated before
 * the guideline engine holds the earlier worksheet (a typed land rate and a
 * cost per m²), none of which carries over.
 */
function isGuidelineWorksheet(value: unknown): value is CivilWorksheet {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<CivilWorksheet>;
  return (
    typeof candidate.location === 'object' &&
    candidate.location !== null &&
    typeof candidate.siteWorks === 'object' &&
    candidate.siteWorks !== null &&
    Array.isArray(candidate.buildings)
  );
}

export function initialState(
  initial: unknown,
  buildingIds: readonly string[],
  today: string,
): WorksheetState {
  const saved = isGuidelineWorksheet(initial) ? initial : null;
  const earlier = (initial ?? {}) as { valuationDate?: unknown; remarks?: unknown };
  const savedBuildings = new Map((saved?.buildings ?? []).map((b) => [b.buildingId, b]));
  const quantity = (w: { item: string; quantity: string; completionPercent: string | null }) => ({
    item: w.item,
    quantity: w.quantity,
    completion: text(w.completionPercent),
  });

  return {
    valuationDate:
      saved?.valuationDate ??
      (typeof earlier.valuationDate === 'string' ? earlier.valuationDate : today),
    location: {
      city: saved?.location.city ?? '',
      purpose: saved?.location.purpose ?? '',
      propertyType: saved?.location.propertyType ?? '',
      floorLevel: text(saved?.location.floorLevel),
      utility: saved?.location.utility ?? '',
      neighbourhood: saved?.location.neighbourhood ?? '',
      roadQuality: saved?.location.roadQuality ?? '',
      roadWidth: saved?.location.roadWidth ?? '',
      proximity: saved?.location.proximity ?? '',
      accessibility: saved?.location.accessibility ?? '',
    },
    lease: {
      totalYears: text(saved?.lease.totalYears),
      totalAmount: text(saved?.lease.totalAmount),
      paidAmount: text(saved?.lease.paidAmount),
      freeholdArea: text(saved?.lease.freeholdArea),
    },
    buildings: Object.fromEntries(
      buildingIds.map((id) => {
        const entry = savedBuildings.get(id);
        if (!entry) return [id, blankBuilding()];
        return [
          id,
          {
            costType: entry.costType,
            count: entry.count,
            heightM: text(entry.heightM),
            components: Object.fromEntries(
              entry.components.map((c) => [
                String(c.row),
                { share: c.sharePercent, completion: text(c.completionPercent) },
              ]),
            ),
            newComponents: entry.newComponents.map((n) => ({
              category: n.category,
              description: text(n.description),
              unitRate: n.unitRate,
              share: n.sharePercent,
              completion: text(n.completionPercent),
            })),
            defects: Object.fromEntries(entry.defects.map((d) => [String(d.code), d.percent])),
            supplementary: entry.supplementary.map(quantity),
          } satisfies BuildingState,
        ];
      }),
    ),
    civil: (saved?.siteWorks.civil ?? []).map((w) => ({
      item: w.item,
      description: text(w.description),
      quantity: text(w.quantity),
      completion: text(w.completionPercent),
      length: text(w.pool?.length),
      width: text(w.pool?.width),
      depth: text(w.pool?.depth),
    })),
    gasStation: (saved?.siteWorks.gasStation ?? []).map(quantity),
    coffeeSite: (saved?.siteWorks.coffeeSite ?? []).map(quantity),
    reconciliation: saved?.reconciliation ?? {
      override: false,
      costWeight: '75',
      salesWeight: '25',
      rationale: '',
    },
    forcedSale: saved?.forcedSale ?? { override: false, percent: '', reason: '' },
    remarks: saved?.remarks ?? (typeof earlier.remarks === 'string' ? earlier.remarks : '') ?? '',
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isPoolItem(guide: CivilGuide, item: string): boolean {
  return guide.poolItems.some((name) => same(name, item));
}

/** The request body for a calculation: the worksheet, nothing added. */
export function toWorksheet(
  ws: WorksheetState,
  buildingIds: readonly string[],
  guide: CivilGuide,
): unknown {
  const quantity = (w: QuantityEntry) => ({
    item: w.item,
    quantity: w.quantity,
    completionPercent: w.completion,
  });
  return {
    valuationDate: ws.valuationDate,
    location: ws.location,
    lease: ws.lease,
    buildings: buildingIds.map((id) => {
      const b = ws.buildings[id] ?? blankBuilding();
      return {
        buildingId: id,
        costType: b.costType,
        count: b.count,
        heightM: b.heightM,
        components: Object.entries(b.components)
          .filter(([, c]) => c.share.trim() !== '')
          .map(([row, c]) => ({
            row: Number(row),
            sharePercent: c.share,
            completionPercent: c.completion,
          }))
          .sort((x, y) => x.row - y.row),
        newComponents: b.newComponents.map((n) => ({
          category: n.category,
          description: n.description,
          unitRate: n.unitRate,
          sharePercent: n.share,
          completionPercent: n.completion,
        })),
        defects: Object.entries(b.defects)
          .filter(([, percent]) => percent.trim() !== '')
          .map(([code, percent]) => ({ code: Number(code), percent }))
          .sort((x, y) => x.code - y.code),
        supplementary: b.supplementary.map(quantity),
      };
    }),
    siteWorks: {
      civil: ws.civil.map((w) => ({
        item: w.item,
        description: w.description,
        quantity: w.quantity,
        completionPercent: w.completion,
        pool: isPoolItem(guide, w.item)
          ? { length: w.length, width: w.width, depth: w.depth }
          : null,
      })),
      gasStation: ws.gasStation.map(quantity),
      coffeeSite: ws.coffeeSite.map(quantity),
    },
    reconciliation: ws.reconciliation,
    forcedSale: ws.forcedSale,
    remarks: ws.remarks,
  };
}

/**
 * Turn a server path like `worksheet.buildings.2.components.0.sharePercent`
 * into a line a valuator can act on.
 */
export function describeIssue(
  path: string,
  message: string,
  buildingNumbers: readonly number[],
): string {
  const parts = path.split('.');
  if (parts[1] === 'buildings' && parts[2] !== undefined) {
    const number = buildingNumbers[Number(parts[2])] ?? Number(parts[2]) + 1;
    return `Building ${number}: ${message}`;
  }
  if (parts[1] === 'siteWorks' && parts[2] !== undefined && parts[3] !== undefined) {
    const list =
      parts[2] === 'civil'
        ? 'Plot civil work'
        : parts[2] === 'gasStation'
          ? 'Fuel station item'
          : 'Coffee site item';
    return `${list} ${Number(parts[3]) + 1}: ${message}`;
  }
  return message;
}

/** The forced-sale percentage the guideline prescribes for the chosen city and purpose. */
export function prescribedForcedSalePercent(
  guide: CivilGuide,
  city: string,
  purpose: string,
): number {
  const listed = guide.foreclosure.purposes.some((p) => same(p, purpose))
    ? guide.cities.find((c) => same(c.name, city))?.foreclosurePercent
    : null;
  return listed ?? guide.foreclosure.defaultPercent;
}
