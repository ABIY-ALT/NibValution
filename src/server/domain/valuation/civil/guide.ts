import { excelIncludes } from './excel';
import {
  EXCEL_FIXES_KEY,
  GUIDELINE_KEYS,
  readExcelFixes,
  type BuildingRulesTable,
  type CitiesTable,
  type CivilWorksTable,
  type ComponentsTable,
  type DefectsTable,
  type ExcelFixes,
  type ForeclosureTable,
  type GuidelineSource,
  type ListsTable,
  type LocationFactorsTable,
  type LocationValueTable,
  type RatedItem,
  type RatedItemsTable,
  type RemarksTable,
  type SwimmingPoolTable,
} from './guideline';

/**
 * What the valuator chooses from when filling in a civil worksheet: every
 * list the guideline defines, in the guideline's own order and wording.
 *
 * Built from the parameter set in force, so a new guideline release changes
 * the form's choices without a line of interface code changing.
 */
export interface CivilGuide {
  readonly version: string;
  readonly cities: readonly {
    readonly name: string;
    readonly group: string | null;
    /** Forced-sale percentage listed for the city; null takes the default. */
    readonly foreclosurePercent: number | null;
  }[];
  readonly purposes: readonly string[];
  readonly propertyTypes: readonly string[];
  /** Property types that are asked their floor level. */
  readonly floorLevelTypes: readonly string[];
  readonly ratings: {
    readonly utility: readonly string[];
    readonly neighbourhood: readonly string[];
    readonly roadQuality: readonly string[];
    readonly roadWidth: readonly string[];
    readonly proximity: readonly string[];
    readonly accessibility: readonly string[];
  };
  readonly buildingTypes: readonly {
    readonly name: string;
    readonly needsHeight: boolean;
    readonly components: readonly {
      readonly row: number;
      readonly element: string;
      readonly part: string | null;
      readonly name: string;
      readonly grade: string;
      /** Weight as a percentage of the building. */
      readonly weightPercent: number;
    }[];
  }[];
  readonly defects: readonly {
    readonly code: number;
    readonly group: string;
    readonly label: string;
  }[];
  readonly newComponentCategories: readonly string[];
  readonly civilWorks: readonly (RatedItem & { readonly lumpSum: boolean })[];
  readonly poolItems: readonly string[];
  readonly supplementary: readonly RatedItem[];
  readonly gasStation: readonly RatedItem[];
  readonly coffeeSite: readonly RatedItem[];
  readonly remarks: readonly {
    readonly section: string;
    readonly case: string | null;
    readonly remark: string;
    readonly impact: string | null;
  }[];
  readonly lease: {
    readonly fullValueFromRemainingYears: number;
    readonly bothLeaseBelowRemainingYears: number;
  };
  readonly foreclosure: {
    readonly purposes: readonly string[];
    readonly defaultPercent: number;
  };
  readonly fixes: ExcelFixes;
}

/** The guide for a parameter set, or null where the guideline tables are not installed. */
export function civilGuide(tables: Readonly<Record<string, unknown>>): CivilGuide | null {
  const table = <T>(key: string): T | null => (tables[key] as T | undefined) ?? null;
  const source = table<GuidelineSource>(GUIDELINE_KEYS.source);
  const cities = table<CitiesTable>(GUIDELINE_KEYS.cities);
  const lists = table<ListsTable>(GUIDELINE_KEYS.lists);
  const factors = table<LocationFactorsTable>(GUIDELINE_KEYS.locationFactors);
  const components = table<ComponentsTable>(GUIDELINE_KEYS.components);
  const rules = table<BuildingRulesTable>(GUIDELINE_KEYS.buildingRules);
  const defects = table<DefectsTable>(GUIDELINE_KEYS.defects);
  const civilWorks = table<CivilWorksTable>(GUIDELINE_KEYS.civilWorks);
  const pool = table<SwimmingPoolTable>(GUIDELINE_KEYS.swimmingPool);
  const locationValue = table<LocationValueTable>(GUIDELINE_KEYS.locationValue);
  const foreclosure = table<ForeclosureTable>(GUIDELINE_KEYS.foreclosure);
  if (
    !source ||
    !cities ||
    !lists ||
    !factors ||
    !components ||
    !rules ||
    !defects ||
    !civilWorks ||
    !pool ||
    !locationValue ||
    !foreclosure
  ) {
    return null;
  }
  const items = (key: string): RatedItem[] => table<RatedItemsTable>(key)?.items ?? [];
  const listed = Object.entries(foreclosure.percentByCity);

  return {
    version: source.version,
    cities: Object.entries(cities.cities)
      // A town with no class cannot have its location factors read.
      .filter(([, city]) => city.class !== null)
      .map(([name, city]) => ({
        name,
        group: city.group,
        foreclosurePercent:
          listed.find(([listedName]) => excelIncludes([listedName], name))?.[1] ?? null,
      })),
    purposes: lists.purposes,
    propertyTypes: lists.propertyTypes,
    floorLevelTypes: factors.floorLevel.types,
    ratings: {
      utility: factors.utility.choices,
      neighbourhood: factors.neighbourhood.choices,
      roadQuality: factors.roadQuality.choices,
      roadWidth: factors.roadWidth.choices,
      proximity: factors.proximity.choices,
      accessibility: factors.accessibility.choices,
    },
    buildingTypes: Object.entries(components.components).map(([name, list]) => ({
      name,
      needsHeight:
        excelIncludes(rules.volumeRatedTypes, name) ||
        excelIncludes(rules.heightAdjustedTypes, name),
      components: list.map((c) => ({
        row: c.row,
        element: c.element,
        part: c.part,
        name: c.name,
        grade: c.grade,
        weightPercent: Number((c.weight * 100).toFixed(4)),
      })),
    })),
    defects: defects.defects.map(({ code, group, label }) => ({ code, group, label })),
    newComponentCategories: lists.newComponentCategories,
    civilWorks: civilWorks.items.map(({ name, rate, lumpSum }) => ({ name, rate, lumpSum })),
    poolItems: pool.items.map((i) => i.name),
    supplementary: items(GUIDELINE_KEYS.supplementary),
    gasStation: items(GUIDELINE_KEYS.gasStation),
    coffeeSite: items(GUIDELINE_KEYS.coffeeSite),
    remarks: table<RemarksTable>(GUIDELINE_KEYS.remarks)?.remarks ?? [],
    lease: {
      fullValueFromRemainingYears: locationValue.lease.fullValueFromRemainingYears,
      bothLeaseBelowRemainingYears: locationValue.lease.bothLeaseBelowRemainingYears,
    },
    foreclosure: { purposes: foreclosure.purposes, defaultPercent: foreclosure.defaultPercent },
    fixes: readExcelFixes({
      setCode: '',
      setVersion: 0,
      values: {},
      tables: { [EXCEL_FIXES_KEY]: tables[EXCEL_FIXES_KEY] },
    }),
  };
}
