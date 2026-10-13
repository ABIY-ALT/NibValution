import type { EngineParameters } from '../common';
import { excelEquals, excelKey } from './excel';
import {
  GUIDELINE_KEYS,
  type CitiesTable,
  type CivilWorksTable,
  type ComponentsTable,
  type CostCurvesTable,
  type ForeclosureTable,
  type PolygonsTable,
  type RatedItemsTable,
  type SwimmingPoolTable,
} from './guideline';
import { propertyClassOf } from './land';
import type { CivilEngineInput } from './types';

/**
 * The parameters one civil valuation reads, cut down from the whole guideline.
 *
 * Every calculation run stores the parameters it used, so that it can be
 * re-run and compared years later. The guideline holds some 330 cities, 300
 * location zones and a thousand building components; a run reads one city,
 * the zones of that city and class, and the components of the building types
 * on the plot. Keeping only those makes the stored snapshot the working it
 * claims to be - and a few kilobytes rather than most of a megabyte.
 *
 * The cut is by what the input *names*, never by what the engine would decide:
 * every zone of the city and class is kept, so the stored run still performs
 * the zone search itself. `calculateCivil` gives the same output on the result
 * as on the full set (tests/unit/civil-engine.test.ts holds it to that).
 */
export function selectCivilParameters(
  params: EngineParameters,
  input: CivilEngineInput,
): EngineParameters {
  const tables: Record<string, unknown> = { ...params.tables };
  const cut = <T>(key: string, trim: (table: T) => T) => {
    const table = tables[key] as T | undefined;
    if (table !== undefined && table !== null) tables[key] = trim(table);
  };
  const named = (names: readonly string[]) => {
    const keys = new Set(names.map(excelKey));
    return (name: string) => keys.has(excelKey(name));
  };

  const city = input.location.city;
  const isCity = (name: string) => excelEquals(name, city);
  const propertyClass = propertyClassOf(input.location.purpose);

  cut<CitiesTable>(GUIDELINE_KEYS.cities, (t) => ({
    ...t,
    cities: Object.fromEntries(Object.entries(t.cities).filter(([name]) => isCity(name))),
  }));
  cut<ForeclosureTable>(GUIDELINE_KEYS.foreclosure, (t) => ({
    ...t,
    percentByCity: Object.fromEntries(
      Object.entries(t.percentByCity).filter(([name]) => isCity(name)),
    ),
  }));
  cut<PolygonsTable>(GUIDELINE_KEYS.polygons, (t) => ({
    ...t,
    polygons:
      input.land.latitude === null || input.land.longitude === null
        ? []
        : t.polygons.filter((p) => isCity(p.city) && excelEquals(p.propertyClass, propertyClass)),
  }));

  const isCostType = named(input.buildings.map((b) => b.costType));
  cut<CostCurvesTable>(GUIDELINE_KEYS.costCurves, (t) => ({
    ...t,
    curves: Object.fromEntries(Object.entries(t.curves).filter(([type]) => isCostType(type))),
  }));
  cut<ComponentsTable>(GUIDELINE_KEYS.components, (t) => ({
    ...t,
    components: Object.fromEntries(
      Object.entries(t.components)
        .filter(([type]) => isCostType(type))
        .map(([type, list]) => {
          const rows = new Set(
            input.buildings
              .filter((b) => excelEquals(b.costType, type))
              .flatMap((b) => b.components.map((c) => c.row)),
          );
          return [type, list.filter((c) => rows.has(c.row))];
        }),
    ),
  }));

  const isCivilWork = named(input.siteWorks.civil.map((w) => w.item));
  cut<CivilWorksTable>(GUIDELINE_KEYS.civilWorks, (t) => ({
    ...t,
    items: t.items.filter((i) => isCivilWork(i.name)),
  }));
  cut<SwimmingPoolTable>(GUIDELINE_KEYS.swimmingPool, (t) => ({
    ...t,
    items: t.items.filter((i) => isCivilWork(i.name)),
  }));
  const isSupplementary = named(input.buildings.flatMap((b) => b.supplementary.map((s) => s.item)));
  const isGasStation = named(input.siteWorks.gasStation.map((w) => w.item));
  const isCoffeeSite = named(input.siteWorks.coffeeSite.map((w) => w.item));
  cut<RatedItemsTable>(GUIDELINE_KEYS.supplementary, (t) => ({
    ...t,
    items: t.items.filter((i) => isSupplementary(i.name)),
  }));
  cut<RatedItemsTable>(GUIDELINE_KEYS.gasStation, (t) => ({
    ...t,
    items: t.items.filter((i) => isGasStation(i.name)),
  }));
  cut<RatedItemsTable>(GUIDELINE_KEYS.coffeeSite, (t) => ({
    ...t,
    items: t.items.filter((i) => isCoffeeSite(i.name)),
  }));

  // The report remarks are a writing aid, not an input to any figure.
  delete tables[GUIDELINE_KEYS.remarks];

  return { ...params, tables };
}
