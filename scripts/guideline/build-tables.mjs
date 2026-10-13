#!/usr/bin/env node
/**
 * Builds the valuation-guideline parameter tables from the Excel estimation
 * template - either the reference tables extracted from it
 * (docs/guideline/<version>/reference_tables) or the template workbook itself.
 *
 *   node scripts/guideline/build-tables.mjs [version] [--from-workbook <template.xlsm>]
 *        [--out <tables.json>] [--sql <migration.sql>] [--check]
 *
 * Writes prisma/seed/guideline/<version>.json (or --out): one entry per
 * `guideline.*` valuation parameter, which the seed loads for a fresh install
 * and the migration loads into an existing database. With --sql it also writes
 * the migration that inserts those parameters into every parameter set.
 *
 * --from-workbook reads the hidden reference sheets of a template workbook
 * directly, so a new guideline release can be taken from the template the
 * valuation unit publishes, without exporting anything from Excel. --check
 * compares the tables with those published for the version instead of writing
 * them, and exits non-zero where any differ.
 *
 * Nothing here interprets the tables beyond reshaping them: each value is the
 * cell the Excel reads, and each table notes the sheet and range it came from,
 * so a reviewer can check any figure against the workbook.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorkbook } from './workbook.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const sqlPath = option('--sql');
const workbookPath = option('--from-workbook');
const outPath = option('--out');
const version =
  args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'v4.2';
const SOURCE = join(ROOT, 'docs', 'guideline', version, 'reference_tables');
const workbook = workbookPath ? openWorkbook(resolve(workbookPath)) : null;

/** The template sheet each extracted reference table came from. */
const SHEETS = {
  'Location_Parameters.csv': 'Location Parameters',
  'LHR_without_coordinate.csv': 'LHR without coordinate',
  'MCF_Location_Coefficents.csv': 'MCF & Location Coefficents',
  'FORECLOSURE.csv': 'FORECLOSURE',
  'cost_summery.csv': 'cost summery',
  'Internal_or_Plot_Civil_Works.csv': 'Internal or Plot Civil Works',
  'Swimming_pool.csv': 'Swimming pool',
  'Fuel_Stations_and_Coffee_Wash.csv': 'Fuel Stations and Coffee Wash',
  'Supplementary_Works.csv': 'Supplementary Works',
  'REMARK.csv': 'REMARK',
};

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

/** A reference table as rows of text from A1, from the template or its CSV export. */
const csv = (name) =>
  workbook ? workbook.grid(SHEETS[name]) : parseCsv(readFileSync(join(SOURCE, name), 'utf8'));

/** Cell by 1-based Excel row and column letter(s). */
function cellOf(rows) {
  return (row, column) => {
    const index = typeof column === 'number' ? column : colIndex(column);
    return (rows[row - 1]?.[index] ?? '').trim();
  };
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A number as Excel stored it, cleaned of binary noise such as
 * 0.7999999999999999 - twelve significant decimals keep every rate exact.
 */
function num(text) {
  if (text === '' || text === null || text === undefined) return null;
  const value = Number(String(text).trim());
  if (!Number.isFinite(value)) return null;
  return Number(value.toPrecision(15));
}

const clean = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const norm = (text) => clean(text).toLowerCase();

function numbersFrom(cell, row, startColumn) {
  const out = [];
  for (let c = colIndex(startColumn); ; c++) {
    const v = num(cell(row, c));
    if (v === null) break;
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cities: Location Parameters L:O, LHR without coordinate F:H, MCF A:M
// ---------------------------------------------------------------------------

const PURPOSES = [
  'RESIDENTIAL',
  'COMMERCIAL',
  'MIXED USE',
  'SHOP',
  'HOTEL',
  'RESORT',
  'INDUSTRIAL',
  'SCHOOL',
  'HOSPITAL',
  'COFFEE SITE',
  'GAS STATION',
];

function buildCities() {
  const cities = new Map();
  const entry = (name) => {
    const key = norm(name);
    if (!cities.has(key)) {
      cities.set(key, {
        name: clean(name),
        grade: null,
        group: null,
        class: null,
        baseRates: null,
        mcfGrade: null,
        mcf: null,
      });
    }
    return cities.get(key);
  };

  const lp = csv('Location_Parameters.csv');
  const lpCell = cellOf(lp);
  for (let r = 2; r <= lp.length; r++) {
    const name = lpCell(r, 'L');
    if (!name) continue;
    const city = entry(name);
    city.name = clean(name);
    city.grade = lpCell(r, 'M') || null;
    city.group = lpCell(r, 'N') || null;
    city.class = lpCell(r, 'O') || null;
  }

  const lhr = csv('LHR_without_coordinate.csv');
  const lhrCell = cellOf(lhr);
  for (let r = 1; r <= lhr.length; r++) {
    const name = lhrCell(r, 'F');
    if (!name) continue;
    const rates = {};
    for (let k = 0; k < 3; k++) {
      const code = lhrCell(r + k, 'G');
      const rate = num(lhrCell(r + k, 'H'));
      if (!['R', 'C', 'I'].includes(code) || rate === null) {
        throw new Error(`LHR city table: ${name} row ${r + k} is not an R/C/I rate row`);
      }
      rates[code] = rate;
    }
    entry(name).baseRates = rates;
  }

  const mcf = csv('MCF_Location_Coefficents.csv');
  const mcfCell = cellOf(mcf);
  const header = PURPOSES.map((_, i) => mcfCell(1, i + 2));
  if (header.join('|') !== PURPOSES.join('|')) {
    throw new Error(`MCF header changed: ${header.join('|')}`);
  }
  for (let r = 2; r <= mcf.length; r++) {
    const name = mcfCell(r, 'A');
    if (!name) continue;
    const city = entry(name);
    city.mcfGrade = mcfCell(r, 'B') || null;
    city.mcf = Object.fromEntries(PURPOSES.map((p, i) => [p, num(mcfCell(r, i + 2))]));
  }

  return Object.fromEntries(
    [...cities.values()]
      .sort((a, b) => (a.name === 'Addis Ababa' ? -1 : b.name === 'Addis Ababa' ? 1 : 0))
      .map(({ name, ...rest }) => [name, rest]),
  );
}

function buildForeclosure() {
  const rows = csv('FORECLOSURE.csv');
  const cell = cellOf(rows);
  const percentByCity = {};
  for (let r = 4; r <= 24; r++) {
    const city = cell(r, 'C');
    const fraction = num(cell(r, 'D'));
    if (city && fraction !== null) percentByCity[clean(city)] = Number((fraction * 100).toFixed(4));
  }
  return {
    source: "FORECLOSURE!C4:D24 and REPORT-COMPLETED!H141",
    percentByCity,
    purposes: ['RESIDENTIAL', 'COMMERCIAL', 'SHOP'],
    defaultPercent: 70,
  };
}

// ---------------------------------------------------------------------------
// Land: plot-size tiers, maximum-rate rules, location parameters
// ---------------------------------------------------------------------------

function buildTiers() {
  const rows = csv('LHR_without_coordinate.csv');
  const cell = cellOf(rows);
  const table = (thresholdRow, factorRow) => {
    const thresholds = numbersFrom(cell, thresholdRow, 'J');
    const factors = numbersFrom(cell, factorRow, 'K');
    if (thresholds.length !== factors.length) {
      throw new Error(`Tier rows ${thresholdRow}/${factorRow}: ${thresholds.length} thresholds, ${factors.length} factors`);
    }
    return { thresholds, factors };
  };
  return {
    source:
      "LHR without coordinate: other towns J1:R3 / K4:S6 (C12:C14), Addis Ababa J8:AD10 / K11:AE13 (C16:C18)",
    note: 'The first tier, up to the first threshold, is always at the full maximum rate; factors[i] applies between thresholds[i] and thresholds[i+1], and the last factor above the last threshold.',
    other: { R: table(1, 4), C: table(2, 5), I: table(3, 6) },
    addis: { R: table(8, 11), C: table(9, 12), I: table(10, 13) },
  };
}

function buildMaxRateRules() {
  return {
    source: "LHR without coordinate!B10 (no polygon) and LHR with coordinate!B11 (polygon)",
    // Spelled exactly as the Excel formula spells them: "Alemegena" and "Koye
    // Fechie" do not match the city list ("Alemgena", "Koye Feche"), so those two
    // towns do not get the surrounding-town multiplier (CALCULATION_SPEC issue 11).
    surroundingTowns: [
      'Addis Ababa', 'Legetafo', 'Alemegena', 'Sebeta', 'Gelan', 'Burayu', 'Anfo', 'Ashewa Meda',
      'Furi', 'Keta (Sansussi)', 'Tatek', 'Weletie', 'Woybila Mariam', 'Dukem', 'Bishoftu',
      'Koye Fechie', 'Tulu Dimtu',
    ],
    regionalCities: [
      'Mekelle', 'Gonder', 'Bahir Dar', 'Adama', 'Hawassa', 'Jimma', 'Hossaena', 'Debre Birhan',
      'Dire Dawa', 'Dessie', 'Wolkite', 'Shashemene', 'Harar', 'Jigjiga', 'Arba Minch',
      'Wollayta Sodo', 'Kombolcha', 'Adigrat', 'Shire Endasilassie', 'Debre Markos', 'Nekemte',
      'Woldiya',
    ],
    institutionalPurposes: ['SCHOOL', 'HOSPITAL', 'RESORT'],
    withoutCoordinates: {
      coffeeSite: { surrounding: 1.25, other: 1.5625 },
      gasStation: 1.5,
      institutional: { surrounding: 1.5, regional: 1.875, other: 1.725 },
      addisCommercial: 1.305,
      surrounding: 1,
      regional: 1.25,
      industrial: { smallPlotBelow: 1000, smallPlotOutsideAddis: 1.64, other: 1.25 },
      other: 1.15,
    },
    withCoordinates: {
      institutional: 1.5,
      gradeFactors: {
        'COMMERCIAL-Prime 1-B': 1.21,
        'COMMERCIAL-Prime 2-A': 1.28,
        'COMMERCIAL-Prime 2-B': 1.35,
        'COMMERCIAL-Prime 2-C': 1.35,
        'COMMERCIAL-Middle - A': 1.19,
        'COMMERCIAL-Middle - B': 1.17,
        'COMMERCIAL-Middle - C': 1.305,
      },
    },
  };
}

/**
 * The zones of the coordinate-list sheets: a pair of columns each, the zone's
 * name, city, grade, class and maximum rate at the top and its corner points
 * below, as latitude and longitude.
 */
function polygonsFromWorkbook() {
  const zones = [];
  const read = (sheet, source, headerRow, nameRow) => {
    const rows = workbook.grid(sheet);
    const width = Math.max(...rows.map((row) => row.length));
    for (let column = 1; column <= width; column += 2) {
      const at = (row, offset = 0) => rows[row - 1]?.[column - 1 + offset] ?? '';
      if (clean(at(headerRow)) !== 'Location/city name') continue;
      const points = [];
      for (let row = headerRow + 5; row <= rows.length; row++) {
        const lat = num(at(row));
        const lon = num(at(row, 1));
        if (lat === null || lon === null) break;
        points.push([lat, lon]);
      }
      const first = points[0];
      const last = points[points.length - 1];
      zones.push({
        source,
        area_name: nameRow ? at(nameRow) : '',
        city: at(headerRow, 1),
        grade: at(headerRow + 1, 1),
        property_class: at(headerRow + 2, 1),
        max_location_rate: num(at(headerRow + 3, 1)),
        polygon_lat_lon: points,
        closed: !!first && first[0] === last[0] && first[1] === last[1],
      });
    }
  };
  read('ADDIS ABABA COORDINATE LIST', 'addis_ababa', 3, 1);
  read('OUTLINE COORDINATE LIST', 'outline', 2, null);
  return zones;
}

function buildPolygons() {
  const raw = workbook
    ? polygonsFromWorkbook()
    : JSON.parse(readFileSync(join(SOURCE, 'location_polygons.json'), 'utf8'));
  const polygons = raw
    .filter((p) => p.city && p.city !== 0 && p.city !== '0' && p.property_class)
    .map((p) => ({
      source: p.source,
      city: clean(p.city),
      areaName: clean(p.area_name) || null,
      grade: clean(p.grade),
      propertyClass: clean(p.property_class),
      maxRate: num(p.max_location_rate),
      points: p.polygon_lat_lon.map(([lat, lon]) => [Number(lat), Number(lon)]),
    }));
  return {
    source: "ADDIS ABABA COORDINATE LIST and OUTLINE COORDINATE LIST (location_polygons.json), matched by LHR with coordinate",
    note: 'Points are [latitude, longitude]. The first polygon whose city and property class match and which contains the point wins; an unclosed polygon never matches (VBA PtInPoly).',
    polygons,
  };
}

function buildLocationFactors() {
  const rows = csv('Location_Parameters.csv');
  const cell = cellOf(rows);
  const labels = (row, from, to) => {
    const out = [];
    for (let c = colIndex(from); c <= colIndex(to); c++) out.push(clean(cell(row, c)));
    return out;
  };
  const values = (row, from, count) => {
    const out = [];
    for (let c = colIndex(from); out.length < count; c++) {
      const v = num(cell(row, c));
      if (v === null) throw new Error(`Location Parameters row ${row}: missing factor`);
      out.push(v);
    }
    return out;
  };
  const byGroup = (headerRow, last) => {
    const choices = labels(headerRow, 'C', last);
    const table = {};
    for (let r = headerRow + 1; r <= headerRow + 3; r++) table[clean(cell(r, 'A'))] = values(r, 'C', choices.length);
    return { choices, byGroup: table };
  };
  const byClass = (headerRow, last) => {
    const choices = labels(headerRow, 'C', last);
    const table = {};
    for (let r = headerRow + 1; r <= headerRow + 5; r++) table[clean(cell(r, 'A'))] = values(r, 'C', choices.length);
    return { choices, table };
  };
  const byUse = (rowsByUse, last) => {
    const first = byClass(rowsByUse.Residential, last);
    return {
      choices: first.choices,
      byUse: {
        Residential: first.table,
        Commercial: byClass(rowsByUse.Commercial, last).table,
        Industrial: byClass(rowsByUse.Industrial, last).table,
      },
    };
  };
  const barTable = (headerRow) => {
    const table = {};
    for (let r = headerRow + 1; r <= headerRow + 5; r++) table[clean(cell(r, 'A'))] = values(r, 'C', 5);
    return table;
  };
  const percentLabel = (label) => num(label.replace(/[<=>%\s]/g, '')) / 100;

  const neighbourhood = byUse({ Residential: 81, Commercial: 88, Industrial: 95 }, 'F');
  return {
    source: 'Location Parameters (rows 1-100) and COST APPROACH FOR COMPLETED!G404:G411',
    classes: [
      'Addis Ababa',
      'Sheger City',
      'Outline City (G1)',
      'Outline City (G2)',
      'Outline Cities (G3,G4,G5)',
    ],
    roadQuality: byGroup(1, 'I'),
    roadWidth: byGroup(7, 'F'),
    accessibility: byGroup(13, 'G'),
    proximity: byUse({ Residential: 39, Commercial: 46, Industrial: 53 }, 'G'),
    utility: byUse({ Residential: 60, Commercial: 67, Industrial: 74 }, 'F'),
    neighbourhood: {
      ...neighbourhood,
      // G405 looks the class up with MATCH(..., 'Location Parameters'!A89:A93)
      // and no match type, i.e. an approximate match on an unsorted list.
      approximateMatchLabels: [89, 90, 91, 92, 93].map((r) => clean(cell(r, 'A'))),
    },
    bar: {
      thresholds: values(18, 'C', 4),
      industrialThresholds: labels(32, 'C', 'F').map(percentLabel),
      residentialAndVilla: barTable(18),
      commercial: barTable(25),
      industrial: barTable(32),
    },
    floorLevel: { types: ['Condominium', 'Apartment'], perFloor: 0.025, maxFloor: 6, above: 0.85 },
  };
}

function buildLocationValueRules() {
  return {
    source: 'REPORT-COMPLETED!K124, REPORT-PROGRESS!K125, COST APPROACH FOR COMPLETED!H413:H416',
    lease: { fullValueFromRemainingYears: 20, bothLeaseBelowRemainingYears: 25, discountRate: 0.07 },
    staged: { developmentMultiple: 3, lowerShare: 0.3, upperShare: 0.8, minimumShare: 0.5 },
    progress: { lowerShare: 0.3, upperShare: 0.8, minimumShare: 0.5, addShare: 0.2, completionBelow: 0.8, factor: 0.9 },
    addisPrimeMultipliers: {
      'COMMERCIAL-Prime 1-A': 1.509,
      'RESIDENTIAL-Prime 1-A': 1.53,
      'COMMERCIAL-Prime 1-B': 1.26,
      'RESIDENTIAL-Prime 2-A': 1.54,
      'COMMERCIAL-Prime 2-A': 1.25,
      'RESIDENTIAL-Prime 2-B': 1.55,
      'COMMERCIAL-Prime 2-B': 1.24,
      'RESIDENTIAL-Prime 2-C': 1.57,
      'COMMERCIAL-Prime 2-C': 1.24,
    },
    primeMultiplierExcludedTypes: ['Apartment', 'Condominium'],
  };
}

// ---------------------------------------------------------------------------
// Buildings: cost curves, component catalogue, condition defects
// ---------------------------------------------------------------------------

const GRADE_ROWS = { minimum: 1, Good: 2, Excellent: 3, Luxury: 4 };

function buildBuildings() {
  const rows = csv('cost_summery.csv');
  const cell = cellOf(rows);
  const curves = {};
  const components = {};
  for (let block = 0; block < 9; block++) {
    const col = block * 4;
    const type = clean(cell(5, col));
    curves[type] = Object.fromEntries(
      Object.entries(GRADE_ROWS).map(([grade, row]) => {
        if (clean(cell(row, col)) !== grade) throw new Error(`cost summery: ${type} row ${row} is not ${grade}`);
        return [grade, [num(cell(row, col + 1)) ?? 0, num(cell(row, col + 2)) ?? 0, num(cell(row, col + 3)) ?? 0]];
      }),
    );

    let element = '';
    let part = '';
    const list = [];
    for (let r = 6; r <= rows.length; r++) {
      const name = clean(cell(r, col));
      const grade = clean(cell(r, col + 1));
      const weight = num(cell(r, col + 3));
      if (!name) continue;
      if (weight === null) {
        if (/^[IVX]+\.\s/.test(name)) {
          element = name;
          part = '';
        } else if (/^[A-Z]\.\s/.test(name)) part = name;
        continue;
      }
      // The cost sheet reads 'cost summery' row r - 4 in its row r, so the row
      // a component is entered on in the Excel is the catalogue row + 4.
      list.push({ row: r + 4, element, part: part || null, name, grade: grade || 'minimum', weight });
    }
    components[type] = list;
  }

  const defects = [];
  let group = '';
  for (let r = 6; r <= 39; r++) {
    const label = clean(cell(r, 'AQ'));
    const villa = num(cell(r, 'AR'));
    const multi = num(cell(r, 'AS'));
    const mph = num(cell(r, 'AT'));
    if (!label) continue;
    if (villa === null && multi === null && mph === null) {
      group = label;
      continue;
    }
    defects.push({
      code: r,
      group,
      label,
      rates: { Villa: villa ?? 0, 'Multi-Story Building': multi ?? 0, MPH: mph ?? 0 },
    });
  }

  const listColumn = (column, from) => {
    const out = [];
    for (let r = from; r <= rows.length; r++) {
      const v = clean(cell(r, column));
      if (!v) break;
      out.push(v);
    }
    return out;
  };

  return {
    curves: {
      source: "cost summery!A1:AJ5",
      note: 'rate = a·x² + b·x + c with [a, b, c] for the component grade (Poor and any other grade use "minimum"); x is the floor area of one building, or its volume for the volume-rated types.',
      curves,
    },
    components: {
      source: "cost summery!A6:AJ150 (name, grade, weight per building type); entered on COST APPROACH FOR COMPLETED rows 10-200",
      components,
    },
    rules: {
      source: 'COST APPROACH FOR COMPLETED!D10, D223:D231',
      outsideAddisFactor: 1.2,
      volumeRatedTypes: ['MPH above 4m'],
      heightAdjustedTypes: ['MPH above 4m', 'Factory'],
      heightAdjustedAreaMultiplier: 4,
      baseHeight: 4,
      upliftPerMetre: 0.2,
    },
    defects: {
      source: "cost summery!AQ6:AT39, read by COST APPROACH FOR COMPLETED!D236:D270",
      categories: ['Villa', 'Multi-Story Building', 'MPH'],
      // D236 picks the column with the old type names (G+1 & 2 ... G+11 &
      // Above), which no building type uses any more, so every type but MPH
      // reads the Villa column (CALCULATION_SPEC issue 3).
      categoryByType: { 'MPH above 4m': 'MPH', 'MPH below 4m': 'MPH' },
      correctedCategoryByType: {
        'MPH above 4m': 'MPH',
        'MPH below 4m': 'MPH',
        '2-5 Storey': 'Multi-Story Building',
        '6-10 Storey': 'Multi-Story Building',
        '11 storey & above': 'Multi-Story Building',
      },
      defaultCategory: 'Villa',
      defects,
      // COST APPROACH FOR PROGRESS has its own defect list (rows 237-265) and
      // it lacks the three floor-finish defects. Its "D) Reinforcement bars
      // visible" fails the lookup in Excel (#N/A); the system depreciates for it.
      progressCodes: [7, 8, 9, 10, 11, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 35, 36, 38, 39],
    },
    newComponentCategories: listColumn('AV', 7),
    propertyTypes: listColumn('AL', 6),
  };
}

// ---------------------------------------------------------------------------
// Site works
// ---------------------------------------------------------------------------

function itemList(rows, nameCol, rateCol, from, to) {
  const cell = cellOf(rows);
  const seen = new Set();
  const items = [];
  for (let r = from; r <= Math.min(to, rows.length); r++) {
    const name = clean(cell(r, nameCol));
    const rate = num(cell(r, rateCol));
    if (!name || rate === null) continue;
    // VLOOKUP returns the first row with the name.
    if (seen.has(norm(name))) continue;
    seen.add(norm(name));
    items.push({ name, rate, row: r });
  }
  return items;
}

function buildSiteWorks() {
  const civilRows = csv('Internal_or_Plot_Civil_Works.csv');
  const civilCell = cellOf(civilRows);
  const lumpSumRows = [148, 149, 150, 151, 206, 207, 208];
  const lumpSum = new Set(lumpSumRows.map((r) => norm(civilCell(r, 'A'))));
  const civil = itemList(civilRows, 'A', 'B', 2, civilRows.length).map(({ name, rate, row }) => ({
    name,
    rate,
    lumpSum: lumpSum.has(norm(name)),
    row,
  }));

  const pool = csv('Swimming_pool.csv');
  const poolCell = cellOf(pool);
  const rate = (row) => num(poolCell(row, 'B')) ?? 0;
  const finishes = {};
  for (let r = 30; r <= 41; r++) {
    const name = clean(poolCell(r, 'A'));
    const value = num(poolCell(r, 'B'));
    if (name && value !== null) finishes[name] = value;
  }
  const findFinish = (label) => {
    const key = norm(label);
    const hit = Object.keys(finishes).find((k) => norm(k) === key);
    return hit ? { name: hit, rate: finishes[hit] } : { name: null, rate: 0 };
  };
  const poolItems = [];
  for (let r = 43; r <= 72; r++) {
    const name = clean(poolCell(r, 'A'));
    if (!name) continue;
    // C22 / C23: the text either side of "with", trimmed, looked up in A30:B41.
    const at = name.indexOf('with');
    const wall = findFinish(name.slice(0, at));
    const floor = findFinish(name.slice(at + 4));
    poolItems.push({ name, wallFinish: wall.name, wallRate: wall.rate, floorFinish: floor.name, floorRate: floor.rate });
  }

  const fuel = csv('Fuel_Stations_and_Coffee_Wash.csv');
  return {
    civil: {
      source: "Internal or Plot Civil Works!A:B, priced by COST APPROACH FOR COMPLETED!F333:F348",
      note: 'Lump-sum items (rows 148-151, 206-208) are priced once whatever the quantity; swimming pools are priced from their bill of quantities.',
      items: civil,
    },
    swimmingPool: {
      source: "Swimming pool!B6:B41, A43:A72 and the row formulas E6:E27",
      rates: {
        siteClearance: rate(6),
        excavationTo150: rate(8),
        excavation150To300: rate(9),
        fillBelowHardcore: rate(11),
        fillAroundWall: rate(12),
        hardcore: rate(13),
        cartAway: rate(14),
        groundSlab: rate(15),
        shearWall: rate(16),
        reinforcement: rate(17),
        formwork: rate(18),
        waterproofing: rate(19),
        plastering: rate(21),
      },
      electricalShare: 0.0061,
      sanitaryShare: 0.02,
      finishes,
      items: poolItems,
    },
    supplementary: {
      source: "Supplementary Works!A:D, priced by COST APPROACH FOR COMPLETED!F315:F330",
      items: itemList(csv('Supplementary_Works.csv'), 'A', 'D', 2, 1000).map(({ name, rate }) => ({ name, rate })),
    },
    gasStation: {
      source: "Fuel Stations and Coffee Wash!A2:B15",
      items: itemList(fuel, 'A', 'B', 2, 15).map(({ name, rate }) => ({ name, rate })),
    },
    coffeeSite: {
      source: "Fuel Stations and Coffee Wash!A16:B51",
      items: itemList(fuel, 'A', 'B', 16, 51).map(({ name, rate }) => ({ name, rate })),
    },
  };
}

// ---------------------------------------------------------------------------
// Sale approach, reconciliation, remarks
// ---------------------------------------------------------------------------

function buildSaleApproach() {
  return {
    source: "SALE APPROACH!B1, D5:D13, H11",
    city: 'Addis Ababa',
    purpose: 'RESIDENTIAL',
    propertyTypes: ['Residential Building', 'Condominium', 'Apartment'],
    excludedBuildingTypes: ['6-10 Storey', '11 storey & above', 'MPH below 4m', 'MPH above 4m', 'Factory'],
    residentialBuilding: {
      intercept: -23468801.76,
      plotArea: 37621.33,
      builtUpArea: 58264.56,
      floorArea: 66697.66,
      costRate: 407.9,
      locationRate: 254.21,
    },
    condominium: {
      intercept: -6099230.12139443,
      floorArea: 92282.265872967,
      costRate: 45.019567647,
      locationRate: 115.325464132,
      floorLevel: -32756.23454,
    },
    apartmentFactor: 1.25,
    smallUnit: { floorAreaBelow: 25, valueBelow: 3000000, factor: 1.75 },
  };
}

function buildReconciliation() {
  return {
    source: 'REPORT-COMPLETED!H137:K139, REPORT-PROGRESS!H142:K144',
    completed: {
      condominiumOrApartment: [75, 25],
      prime: [60, 40],
      other: [75, 25],
      condominiumTypes: ['Condominium', 'Apartment'],
      primeGrades: ['Prime 1-A', 'Prime 1-B', 'Prime 2-A', 'Prime 2-B', 'Prime 2-C'],
    },
    progress: { saleTypes: ['Apartment', 'Residential Building'], weights: [75, 25] },
  };
}

function buildRemarks() {
  const rows = csv('REMARK.csv');
  const cell = cellOf(rows);
  const remarks = [];
  let section = '';
  for (let r = 3; r <= rows.length; r++) {
    const no = clean(cell(r, 'A'));
    const caseText = clean(cell(r, 'B'));
    const remark = clean(cell(r, 'C'));
    const impact = clean(cell(r, 'D'));
    if (!no && caseText && !remark) {
      section = caseText;
      continue;
    }
    if (remark) {
      remarks.push({ section, case: caseText || null, remark, impact: impact || null });
    } else if (impact && remarks.length > 0) {
      const last = remarks[remarks.length - 1];
      last.impact = last.impact ? `${last.impact} ${impact}` : impact;
    }
  }
  return { source: 'REMARK!A:D', remarks };
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const buildings = buildBuildings();
const siteWorks = buildSiteWorks();

const PARAMETERS = [
  {
    key: 'guideline.source',
    name: 'Guideline release',
    value: {
      version,
      template: 'Version_4.2_Estimation_template',
      guidelineApproved: '2025-04-23',
      templateUpdated: '2026-08',
      reference: `docs/guideline/${version}/CALCULATION_SPEC.md`,
    },
  },
  { key: 'guideline.cities', name: 'Cities and towns: class, land base rates and MCF', value: { source: "Location Parameters!L:O, LHR without coordinate!F:H, MCF & Location Coefficents!A:M", cities: buildCities() } },
  { key: 'guideline.foreclosure', name: 'Forced-sale (foreclosure) percentage by city', value: buildForeclosure() },
  { key: 'guideline.land_tiers', name: 'Land rate reduction by plot size', value: buildTiers() },
  { key: 'guideline.land_max_rate', name: 'Maximum location rate adjustments', value: buildMaxRateRules() },
  { key: 'guideline.location_polygons', name: 'Location zones (polygons) with maximum rates', value: buildPolygons() },
  { key: 'guideline.location_factors', name: 'Location parameter factors', value: buildLocationFactors() },
  { key: 'guideline.location_value', name: 'Location value: lease, staging and Addis prime multipliers', value: buildLocationValueRules() },
  { key: 'guideline.cost_curves', name: 'Building cost curves by type and grade', value: buildings.curves },
  { key: 'guideline.building_components', name: 'Building component catalogue (grade and weight)', value: buildings.components },
  { key: 'guideline.building_rules', name: 'Building cost rules (location, volume, height)', value: buildings.rules },
  { key: 'guideline.condition_defects', name: 'Building condition defects (depreciation)', value: buildings.defects },
  {
    key: 'guideline.lists',
    name: 'Guideline choice lists',
    value: {
      source: "HOME!E20 (permitted land purpose), cost summery!AL6:AL14 (property type), cost summery!AV7 (new component categories)",
      purposes: PURPOSES,
      // The workbook lists "Condominium or Apartment", but every rule tests for
      // "Condominium" or "Apartment" on its own, so they are listed apart.
      propertyTypes: buildings.propertyTypes.flatMap((t) =>
        t === 'Condominium or Apartment' ? ['Condominium', 'Apartment'] : [t],
      ),
      newComponentCategories: buildings.newComponentCategories,
    },
  },
  { key: 'guideline.civil_works', name: 'Internal and plot civil works rates', value: siteWorks.civil },
  { key: 'guideline.swimming_pool', name: 'Swimming pool bill of quantities', value: siteWorks.swimmingPool },
  { key: 'guideline.supplementary_works', name: 'Supplementary works rates', value: siteWorks.supplementary },
  { key: 'guideline.gas_station_works', name: 'Fuel station works rates', value: siteWorks.gasStation },
  { key: 'guideline.coffee_site_works', name: 'Coffee washing site works rates', value: siteWorks.coffeeSite },
  { key: 'guideline.sale_approach', name: 'Sale approach (regression) for Addis Ababa residences', value: buildSaleApproach() },
  { key: 'guideline.reconciliation', name: 'Reconciliation weights', value: buildReconciliation() },
  { key: 'guideline.remarks', name: 'Standard report remarks', value: buildRemarks() },
].map((p) => ({ ...p, type: 'TABLE', discipline: 'CIVIL', notes: `Guideline ${version} reference table. Published with the guideline release, not edited by hand.` }));

// The corrections to the workbook's known issues (CALCULATION_SPEC section 11).
// Each is off, so the engine reproduces the Excel figures until the valuation
// unit approves a correction and an administrator switches it on. The names
// are the keys of EXCEL_FIXES in src/server/domain/valuation/civil/guideline.ts.
PARAMETERS.push({
  key: 'excel_fixes.switches',
  name: 'Corrections to the Excel workbook',
  type: 'TABLE',
  discipline: 'CIVIL',
  notes: `Each switch corrects one known issue in the Excel estimation template (docs/guideline/${version}/CALCULATION_SPEC.md, section 11). All are off, so figures match the workbook; switch one on only once the valuation unit has approved it.`,
  value: {
    neighbourhoodExactMatch: false,
    industrialBarThresholds: false,
    multiStoreyDefectRates: false,
    bothHoldingDoubleCount: false,
    addisTierFormula: false,
    progressLocationValue: false,
    poolOwnFinishes: false,
    progressFloorDefects: false,
  },
});

// Parameters the first civil formula read and the guideline engine does not.
// They stay in the sets that already hold them - a published version is never
// rewritten - with a note saying what replaced them.
const RETIRED_NOTES = {
  'cost_approach.mcf':
    'No longer read: the civil engine takes the market condition factor for the city and land purpose from the guideline table guideline.cities.',
  'land.lease_valuation_basis':
    'No longer read: the civil engine values lease-held land by the guideline rule (guideline.location_value).',
  'depreciation.economic_life':
    'No longer read: the civil engine depreciates a building by its recorded condition defects (guideline.condition_defects). Mechanical items use mechanical.economic_life.',
  'construction.element_weights':
    'No longer read: a building under construction is valued from the completion of each of its components.',
};

const outDir = join(ROOT, 'prisma', 'seed', 'guideline');
const outFile = outPath ? resolve(outPath) : join(outDir, `${version}.json`);

if (args.includes('--check')) {
  // Compare with the tables already published for this version instead of
  // writing them: does this template still say what the system holds?
  const published = new Map(JSON.parse(readFileSync(outFile, 'utf8')).map((p) => [p.key, p.value]));
  const close = (a, b) =>
    a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  // The first difference between two values, as a path; null where they agree.
  const differ = (a, b, path) => {
    if (typeof a === 'number' && typeof b === 'number') return close(a, b) ? null : path;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return `${path} (${a.length} here, ${b.length} published)`;
      for (let i = 0; i < a.length; i++) {
        const d = differ(a[i], b[i], `${path}[${i}]`);
        if (d) return d;
      }
      return null;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (k === 'source' || k === 'note' || k === 'reference') continue;
        const d = differ(a[k], b[k], `${path}.${k}`);
        if (d) return d;
      }
      return null;
    }
    return a === b ? null : path;
  };
  // A zone is matched first-come within its own list, so only each list's order counts.
  const bySource = (value) =>
    value && Array.isArray(value.polygons)
      ? ['addis_ababa', 'outline'].map((src) => value.polygons.filter((p) => p.source === src))
      : value;
  let changed = 0;
  for (const p of PARAMETERS) {
    if (p.key === 'guideline.source') continue;
    const before = published.get(p.key);
    const d =
      before === undefined ? `${p.key} (not published)` : differ(bySource(p.value), bySource(before), p.key);
    if (d) changed++;
    console.warn(`${d ? 'DIFFERENT' : 'same     '}  ${p.key}${d ? `  - first at ${d}` : ''}`);
  }
  console.warn(
    changed === 0
      ? `The template's tables match guideline ${version} as published.`
      : `${changed} table(s) differ from guideline ${version} as published.`,
  );
  process.exit(changed === 0 ? 0 : 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, `${JSON.stringify(PARAMETERS)}\n`);
console.warn(`wrote ${outFile} (${PARAMETERS.length} parameters)`);

if (sqlPath) {
  const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const header = [
    `-- The valuation guideline (${version}) as parameter tables, and the switches that`,
    "-- correct the Excel workbook's known issues.",
    '--',
    '-- The civil engine (formula civil-2.0.0) reads every rate, factor and list it',
    '-- uses from guideline.* parameters. They are added to every parameter set, old',
    '-- versions included: a valuation dated in the past is calculated with the set',
    '-- then in force, and it needs the tables too. No existing value is changed -',
    '-- ON CONFLICT DO NOTHING leaves any table already published as it is.',
    '--',
    `-- Generated by: node scripts/guideline/build-tables.mjs ${version} --sql <this file>`,
    `-- from docs/guideline/${version}/reference_tables. Do not edit the JSON by hand.`,
    '--',
    '-- Data only: there is no schema change in this migration.',
  ];
  const inserts = PARAMETERS.map(
    (p) =>
      `INSERT INTO "valuation_parameters" ("id", "setId", "key", "name", "type", "jsonValue", "discipline", "categoryCode", "notes")\n` +
      `SELECT gen_random_uuid(), s."id", ${literal(p.key)}, ${literal(p.name)}, 'TABLE', ${literal(JSON.stringify(p.value))}::jsonb, 'CIVIL', '', ${literal(p.notes)}\n` +
      `FROM "valuation_parameter_sets" s\n` +
      `ON CONFLICT ("setId", "key", "categoryCode") DO NOTHING;`,
  );
  const retired = Object.entries(RETIRED_NOTES).map(
    ([key, note]) =>
      `UPDATE "valuation_parameters" SET "notes" = ${literal(note)} WHERE "key" = ${literal(key)};`,
  );
  writeFileSync(
    resolve(sqlPath),
    [
      header.join('\n'),
      inserts.join('\n\n'),
      '-- Parameters the guideline engine no longer reads keep their values, with a\n-- note saying what replaced them.',
      retired.join('\n'),
    ].join('\n\n') + '\n',
  );
  console.warn(`wrote ${sqlPath}`);
}
