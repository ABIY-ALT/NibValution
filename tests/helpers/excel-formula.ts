/**
 * A small evaluator for the subset of Excel formulas the guideline's land-rate
 * sheet uses: numbers, cell references, + - * /, comparisons, IF and IFERROR.
 *
 * It exists so a test can run the workbook's own formula text
 * (docs/guideline/<version>/excel_formulas) and compare it with the engine,
 * rather than trusting a reading of a formula several thousand characters long.
 */

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'cell'; column: string; row: number; rowAbsolute: boolean }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  const text = formula.replace(/^=/, '');
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let match: RegExpExecArray | null;
    if (/^\s/.test(rest)) {
      i++;
    } else if ((match = /^\$?([A-Z]{1,3})(\$?)(\d+)/.exec(rest))) {
      tokens.push({
        kind: 'cell',
        column: match[1]!,
        row: Number(match[3]),
        rowAbsolute: match[2] === '$',
      });
      i += match[0].length;
    } else if ((match = /^\d+(\.\d+)?/.exec(rest))) {
      tokens.push({ kind: 'number', value: Number(match[0]) });
      i += match[0].length;
    } else if ((match = /^"([^"]*)"/.exec(rest))) {
      tokens.push({ kind: 'string', value: match[1]! });
      i += match[0].length;
    } else if ((match = /^[A-Z]+(?=\()/.exec(rest))) {
      tokens.push({ kind: 'name', value: match[0] });
      i += match[0].length;
    } else if ((match = /^(<=|>=|<>|[-+*/(),<>=])/.exec(rest))) {
      tokens.push({ kind: 'op', value: match[0] });
      i += match[0].length;
    } else {
      throw new Error(`Unexpected "${rest.slice(0, 12)}" in formula`);
    }
  }
  return tokens;
}

class ExcelError extends Error {}

/**
 * Evaluate `formula` as if it stood `rowOffset` rows below where it was
 * written, so a formula copied down a column can be run for each copy.
 */
export function evaluateFormula(
  formula: string,
  cell: (column: string, row: number) => number | string,
  rowOffset = 0,
): number | string {
  const tokens = tokenize(formula);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++]!;
  const isOp = (value: string) => {
    const t = peek();
    return t?.kind === 'op' && t.value === value;
  };
  const expect = (value: string) => {
    if (!isOp(value)) throw new Error(`Expected "${value}" at token ${position}`);
    position++;
  };
  const number = (value: number | string): number => {
    if (typeof value === 'number') return value;
    throw new ExcelError('#VALUE!');
  };

  // Skips an argument without evaluating it, as IF does for the untaken branch.
  function skip(): void {
    let depth = 0;
    for (; position < tokens.length; position++) {
      const t = tokens[position]!;
      if (t.kind !== 'op') continue;
      if (t.value === '(') depth++;
      else if (t.value === ')') {
        if (depth === 0) return;
        depth--;
      } else if (t.value === ',' && depth === 0) return;
    }
  }

  function primary(): number | string {
    const t = take();
    if (t.kind === 'number' || t.kind === 'string') return t.value;
    if (t.kind === 'cell') return cell(t.column, t.rowAbsolute ? t.row : t.row + rowOffset);
    if (t.kind === 'op' && t.value === '(') {
      const value = comparison();
      expect(')');
      return value;
    }
    if (t.kind === 'op' && t.value === '-') return -number(primary());
    if (t.kind === 'name' && t.value === 'IF') {
      expect('(');
      const condition = comparison();
      expect(',');
      let result: number | string;
      if (condition) {
        result = comparison();
        expect(',');
        skip();
      } else {
        skip();
        expect(',');
        result = comparison();
      }
      expect(')');
      return result;
    }
    if (t.kind === 'name' && t.value === 'IFERROR') {
      expect('(');
      const start = position;
      let result: number | string;
      try {
        result = comparison();
        expect(',');
        skip();
      } catch (error) {
        if (!(error instanceof ExcelError)) throw error;
        position = start;
        skip();
        expect(',');
        result = comparison();
      }
      expect(')');
      return result;
    }
    throw new Error(`Unsupported token ${JSON.stringify(t)}`);
  }

  function product(): number | string {
    let left = primary();
    while (isOp('*') || isOp('/')) {
      const op = (take() as { value: string }).value;
      const right = number(primary());
      if (op === '/' && right === 0) throw new ExcelError('#DIV/0!');
      left = op === '*' ? number(left) * right : number(left) / right;
    }
    return left;
  }

  function sum(): number | string {
    let left = product();
    while (isOp('+') || isOp('-')) {
      const op = (take() as { value: string }).value;
      const right = number(product());
      left = op === '+' ? number(left) + right : number(left) - right;
    }
    return left;
  }

  function comparison(): number | string {
    const left = sum();
    for (const op of ['<=', '>=', '<>', '<', '>', '=']) {
      if (!isOp(op)) continue;
      position++;
      const right = sum();
      const result =
        op === '<='
          ? left <= right
          : op === '>='
            ? left >= right
            : op === '<>'
              ? left !== right
              : op === '<'
                ? left < right
                : op === '>'
                  ? left > right
                  : left === right;
      return result ? 1 : 0;
    }
    return left;
  }

  const value = comparison();
  if (position !== tokens.length) throw new Error('Formula not fully read');
  return value;
}

/** The formulas of a formula-dump file, by the cell each is written in. */
export function formulasOf(dump: string): Map<string, string> {
  const formulas = new Map<string, string>();
  const sections = dump.split(/^## /m).slice(1);
  for (const section of sections) {
    const [heading = '', ...body] = section.split('\n');
    const cellName = heading.trim().split(/\s/)[0]!;
    formulas.set(cellName, body.join('\n').trim());
  }
  return formulas;
}
