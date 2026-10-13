/**
 * Reads an Excel workbook (.xlsx / .xlsm) without Excel: the cached value and
 * the formula of every cell, sheet by sheet.
 *
 * Used by the guideline scripts to take the reference tables straight out of
 * the estimation template, and to check the engine against a valuation done in
 * it. Node's own zlib only - a workbook is a zip of XML parts, and nothing here
 * needs more than that. Values are those Excel saved with the file; nothing is
 * recalculated.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** The files of a zip archive, by name, each inflated on first read. */
function readZip(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip archive (no end-of-directory record).');
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, () => {
      const dataStart =
        local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(dataStart, dataStart + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported zip compression ${method} for ${name}.`);
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const decode = (text) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

export function columnNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function columnName(number) {
  let name = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

/**
 * Opens a workbook file. `cell(sheet, 'B12')` gives `{ value, formula }`,
 * `value(sheet, 'B12')` the value alone, and `grid(sheet)` the sheet as rows of
 * text from A1 - the shape a CSV export of it would have.
 */
export function openWorkbook(file) {
  const zip = readZip(readFileSync(file));
  const part = (name) => {
    const read = zip.get(name);
    if (!read) throw new Error(`The workbook has no part ${name}.`);
    return read().toString('utf8');
  };

  const workbook = part('xl/workbook.xml');
  const relationships = part('xl/_rels/workbook.xml.rels');
  const targets = new Map();
  for (const m of relationships.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?xl\//, ''));
  }
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/>/g)) {
    const name = decode(/\bname="([^"]+)"/.exec(m[0])[1]);
    const id = /\br:id="([^"]+)"/.exec(m[0])[1];
    sheets.push({ name, part: `xl/${targets.get(id)}` });
  }

  let strings = [];
  if (zip.has('xl/sharedStrings.xml')) {
    strings = [...part('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      decode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
    );
  }

  const parsed = new Map();
  function sheetCells(name) {
    if (parsed.has(name)) return parsed.get(name);
    const info = sheets.find((s) => s.name === name);
    if (!info) throw new Error(`The workbook has no sheet "${name}".`);
    const xml = part(info.part);
    const cells = new Map();
    const pattern = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    for (let m = pattern.exec(xml); m; m = pattern.exec(xml)) {
      const [, ref, attributes, body = ''] = m;
      const type = / t="([^"]+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const inline = /<is>([\s\S]*?)<\/is>/.exec(body)?.[1];
      let value = null;
      if (type === 's' && raw !== undefined) value = strings[Number(raw)];
      else if (type === 'inlineStr' && inline !== undefined) value = decode(inline.replace(/<[^>]+>/g, ''));
      else if ((type === 'str' || type === 'e') && raw !== undefined) value = decode(raw);
      else if (type === 'b' && raw !== undefined) value = raw === '1';
      else if (raw !== undefined) value = Number(raw);
      const formula = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(body)?.[1];
      const isFormula = /<f\b/.test(body);
      cells.set(ref, { value, formula: formula ? decode(formula) : isFormula ? '(shared)' : null });
    }
    parsed.set(name, cells);
    return cells;
  }

  const cell = (sheet, ref) => sheetCells(sheet).get(ref) ?? { value: null, formula: null };
  const value = (sheet, ref) => cell(sheet, ref).value;

  function grid(sheet) {
    const rows = [];
    for (const [ref, { value: v }] of sheetCells(sheet)) {
      if (v === null || v === undefined) continue;
      const [, letters, digits] = /([A-Z]+)(\d+)/.exec(ref);
      const row = Number(digits) - 1;
      const column = columnNumber(letters) - 1;
      rows[row] ??= [];
      rows[row][column] = typeof v === 'number' ? String(v) : String(v);
    }
    return Array.from(rows, (row) => Array.from(row ?? [], (v) => v ?? ''));
  }

  return { sheets: sheets.map((s) => s.name), cell, value, grid };
}

/** An Excel date serial as YYYY-MM-DD. */
export function excelDate(serial) {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(serial)) * 86_400_000);
  return date.toISOString().slice(0, 10);
}
