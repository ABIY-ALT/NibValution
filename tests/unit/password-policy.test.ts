import { describe, expect, it } from 'vitest';
import { validatePasswordComplexity } from '@/server/application/auth-service';

/**
 * The password rules are configuration, not code (spec §37). These tests pin
 * the behaviour of the checker itself: that it reports every violation at once,
 * and that it applies exactly the policy it is given — no more, no less.
 *
 * The bank set the minimum to 6 with character classes off. Both are settings,
 * so raising the bar later is a configuration change rather than a deployment,
 * and these tests cover both stances.
 */
describe('password rules', () => {
  describe('length only (the configured default: 6, no complexity)', () => {
    it('accepts a plain six-character password', () => {
      expect(validatePasswordComplexity('abcdef', 6)).toEqual([]);
    });

    it('accepts six digits', () => {
      // A numeric password is permitted when character classes are not required.
      expect(validatePasswordComplexity('123456', 6)).toEqual([]);
    });

    it('rejects anything shorter, naming the requirement', () => {
      const problems = validatePasswordComplexity('abc', 6);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('at least 6 characters');
    });

    it('does not demand character classes when complexity is off', () => {
      const problems = validatePasswordComplexity('abcdef', 6, false);
      expect(problems.join(' ')).not.toMatch(/upper-case|digit|symbol/);
    });
  });

  describe('with complexity enabled', () => {
    it('accepts a password that mixes every class', () => {
      expect(validatePasswordComplexity('Ab1!cd', 6, true)).toEqual([]);
    });

    it('reports every violation at once rather than one at a time', () => {
      // A user should be able to fix their password in one attempt.
      const problems = validatePasswordComplexity('abc', 6, true);
      expect(problems).toHaveLength(4); // too short, no upper, no digit, no symbol
      expect(problems.join(' ')).toContain('at least 6 characters');
      expect(problems.join(' ')).toContain('upper-case');
      expect(problems.join(' ')).toContain('digit');
      expect(problems.join(' ')).toContain('symbol');
    });

    it('rejects six digits when classes are required', () => {
      expect(validatePasswordComplexity('123456', 6, true).length).toBeGreaterThan(0);
    });
  });

  describe('the policy is honoured exactly as supplied', () => {
    it('enforces a raised minimum without a code change', () => {
      expect(validatePasswordComplexity('abcdefgh', 12)).toHaveLength(1);
      expect(validatePasswordComplexity('abcdefghijkl', 12)).toEqual([]);
    });

    it('treats an empty password as too short rather than crashing', () => {
      expect(validatePasswordComplexity('', 6)).toHaveLength(1);
    });
  });
});
