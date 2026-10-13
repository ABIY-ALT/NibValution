import { describe, expect, it } from 'vitest';
import { remainingGates } from '@/server/domain/workflow/workflow-service';

/**
 * The approval gates still ahead of a case, per band (spec section 17).
 *
 * Every chain starts with CHECKER, but the checker's approval is the
 * CHECKING -> CHECKED step itself. These tests pin that it never reappears as
 * a gate - it used to, and every case then failed on the way into approval.
 */

const UP_TO_5M = ['CHECKER'] as const;
const TO_80M = ['CHECKER', 'MAKER_MANAGER'] as const;
const FROM_80M = ['CHECKER', 'MAKER_MANAGER', 'DIRECTOR'] as const;

describe('approval gates', () => {
  it('approves a case up to ETB 5 million on the checker alone', () => {
    expect(remainingGates(UP_TO_5M, [])).toEqual([]);
  });

  it('sends a mid-band case to the Maker Manager only', () => {
    expect(remainingGates(TO_80M, [])).toEqual(['MAKER_MANAGER']);
    expect(remainingGates(TO_80M, ['MAKER_MANAGER'])).toEqual([]);
  });

  it('sends a case of ETB 80 million and above to the Manager, then the Director', () => {
    expect(remainingGates(FROM_80M, [])).toEqual(['MAKER_MANAGER', 'DIRECTOR']);
    expect(remainingGates(FROM_80M, ['CHECKER', 'MAKER_MANAGER'])).toEqual(['DIRECTOR']);
    expect(remainingGates(FROM_80M, ['MAKER_MANAGER', 'DIRECTOR'])).toEqual([]);
  });

  it('never treats the checker as a gate still to pass', () => {
    for (const chain of [UP_TO_5M, TO_80M, FROM_80M]) {
      expect(remainingGates(chain, [])).not.toContain('CHECKER');
    }
  });
});
