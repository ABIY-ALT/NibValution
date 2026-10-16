import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Excel estimation itself, where it is in the project: the Golla Bee
 * Production PLC valuation, done in the version 4.2 template.
 *
 * The check is the script an administrator would run: the template's reference
 * tables are the guideline tables the system holds
 * (scripts/guideline/build-tables.mjs --check).
 *
 * The workbook is the bank's document, not part of the code, so the suite
 * skips where it is absent.
 */

const ROOT = process.cwd();
const WORKBOOK = join(ROOT, 'Version 4.2 Estimation template Golla Bee Production PLC.xlsm');

const run = (args: string[]) =>
  spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 120_000 });

describe.skipIf(!existsSync(WORKBOOK))('the Golla Bee estimation workbook', () => {
  it('holds the guideline tables the system publishes', () => {
    const result = run([
      join('scripts', 'guideline', 'build-tables.mjs'),
      'v4.2',
      '--from-workbook',
      WORKBOOK,
      '--check',
    ]);
    expect(result.stderr).toMatch(/match guideline v4\.2 as published/);
    expect(result.status).toBe(0);
  });
});
