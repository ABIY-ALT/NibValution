import { BusinessRuleError, ConfigurationError } from '@/lib/errors';
import { dec, type Numeric, Decimal } from '@/lib/money';
import type { ApprovalLevel, CaseStatus, RoleCode } from '../shared/enums';

/**
 * Approval routing (spec section 17) and final-letter authority (section 18).
 *
 * Both ladders are read from configuration; nothing here contains a hard-coded
 * ETB figure. The source defines the approval bands at 5M/80M and the letter
 * authority at 100M - deliberately kept as two independent rule sets, since
 * they are two different policies that happen to be numeric (assumption 1.1).
 *
 * Bands are half-open `[minAmount, maxAmount)` with a null max meaning
 * unbounded, so a value can never fall in a gap or match two bands at once.
 */

export interface ApprovalThresholdRule {
  readonly id: string;
  readonly name: string;
  readonly minAmount: Decimal;
  /** Exclusive upper bound; `null` means unbounded. */
  readonly maxAmount: Decimal | null;
  /** Ordered chain of role codes that must approve, e.g. ["CHECKER","MAKER_MANAGER"]. */
  readonly approvalChain: readonly RoleCode[];
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface FinalLetterRule {
  readonly id: string;
  readonly name: string;
  readonly minAmount: Decimal;
  readonly maxAmount: Decimal | null;
  readonly issuerRole: RoleCode;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface ResolvedRouting {
  readonly rule: ApprovalThresholdRule;
  /** Roles that must still approve, in order, after checking completes. */
  readonly approvalChain: readonly RoleCode[];
  /** The highest approval level the case reaches. */
  readonly highestLevel: ApprovalLevel;
  /** The status the case takes on immediately after checking completes. */
  readonly nextStatusAfterChecking: CaseStatus;
}

/** A rule is in force on `at` when effectiveFrom <= at < effectiveTo (or no end). */
function isEffective(rule: { effectiveFrom: Date; effectiveTo: Date | null }, at: Date): boolean {
  if (rule.effectiveFrom.getTime() > at.getTime()) return false;
  if (rule.effectiveTo !== null && rule.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

function containsAmount(
  rule: { minAmount: Decimal; maxAmount: Decimal | null },
  amount: Decimal,
): boolean {
  if (amount.lessThan(rule.minAmount)) return false;
  if (rule.maxAmount !== null && amount.greaterThanOrEqualTo(rule.maxAmount)) return false;
  return true;
}

/**
 * Validate a complete threshold configuration.
 *
 * Called whenever an administrator saves thresholds, so an invalid ladder is
 * rejected at configuration time rather than discovered when a case cannot be
 * routed. The checks are: at least one rule, coverage from zero, no gaps, no
 * overlaps, exactly one unbounded top band, and non-empty ordered chains.
 */
export function validateThresholdSet(
  rules: readonly ApprovalThresholdRule[],
  at: Date = new Date(),
): void {
  const effective = rules.filter((r) => isEffective(r, at));
  if (effective.length === 0) {
    throw new ConfigurationError(
      'No approval thresholds are in force. Routing cannot be resolved.',
    );
  }

  const sorted = [...effective].sort((a, b) => a.minAmount.comparedTo(b.minAmount));

  const first = sorted[0];
  if (!first || !first.minAmount.isZero()) {
    throw new ConfigurationError(
      'Approval thresholds must start at 0 so that every valuation amount is covered.',
    );
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (!current) continue;

    if (current.approvalChain.length === 0) {
      throw new ConfigurationError(
        `Approval threshold "${current.name}" has an empty approval chain.`,
      );
    }
    if (current.maxAmount !== null && current.maxAmount.lessThanOrEqualTo(current.minAmount)) {
      throw new ConfigurationError(
        `Approval threshold "${current.name}" has an upper bound at or below its lower bound.`,
      );
    }

    const next = sorted[i + 1];
    if (!next) {
      if (current.maxAmount !== null) {
        throw new ConfigurationError(
          'The highest approval threshold must be unbounded so that no valuation exceeds every band.',
        );
      }
      continue;
    }
    if (current.maxAmount === null) {
      throw new ConfigurationError(
        `Approval threshold "${current.name}" is unbounded but is not the highest band.`,
      );
    }
    if (!current.maxAmount.equals(next.minAmount)) {
      const relation = current.maxAmount.lessThan(next.minAmount) ? 'gap' : 'overlap';
      throw new ConfigurationError(
        `Approval thresholds have a ${relation} between "${current.name}" and "${next.name}".`,
      );
    }
  }
}

/** Find the band that contains `amount`, among rules in force at `at`. */
export function findThreshold(
  rules: readonly ApprovalThresholdRule[],
  amount: Numeric,
  at: Date = new Date(),
): ApprovalThresholdRule {
  const value = dec(amount);
  if (value.isNegative()) {
    throw new BusinessRuleError(
      'NEGATIVE_VALUATION',
      'A valuation amount cannot be negative, so no approval band applies.',
    );
  }

  const match = rules.filter((r) => isEffective(r, at)).find((r) => containsAmount(r, value));
  if (!match) {
    throw new ConfigurationError(
      `No approval threshold covers the amount ${value.toFixed(2)}. The threshold configuration is incomplete.`,
    );
  }
  return match;
}

const LEVEL_BY_ROLE: Partial<Record<RoleCode, ApprovalLevel>> = {
  CHECKER: 'CHECKER',
  MAKER_MANAGER: 'MANAGER',
  DIRECTOR: 'DIRECTOR',
};

const LEVEL_RANK: Record<ApprovalLevel, number> = { CHECKER: 0, MANAGER: 1, DIRECTOR: 2 };

/**
 * Resolve the routing for a case.
 *
 * The chain in configuration is cumulative and includes CHECKER, which has
 * already happened by the time this is called - so it is stripped here and the
 * remaining roles are what still need to approve. A chain of `["CHECKER"]`
 * therefore means checking alone finalises the valuation (assumption 1.2).
 */
export function resolveRouting(
  rules: readonly ApprovalThresholdRule[],
  amount: Numeric,
  at: Date = new Date(),
): ResolvedRouting {
  const rule = findThreshold(rules, amount, at);

  const remaining = rule.approvalChain.filter((role) => role !== 'CHECKER');

  let highestLevel: ApprovalLevel = 'CHECKER';
  for (const role of rule.approvalChain) {
    const level = LEVEL_BY_ROLE[role];
    if (level && LEVEL_RANK[level] > LEVEL_RANK[highestLevel]) {
      highestLevel = level;
    }
  }

  const nextStatusAfterChecking = statusForRole(remaining[0]);

  return { rule, approvalChain: remaining, highestLevel, nextStatusAfterChecking };
}

function statusForRole(role: RoleCode | undefined): CaseStatus {
  if (role === undefined) return 'APPROVED';
  switch (role) {
    case 'MAKER_MANAGER':
      return 'PENDING_MANAGER_APPROVAL';
    case 'DIRECTOR':
      return 'PENDING_DIRECTOR_APPROVAL';
    default:
      throw new ConfigurationError(
        `Role "${role}" appears in an approval chain but is not an approving role.`,
      );
  }
}

/**
 * Given the roles that have already approved, what happens next?
 * Returns the next status and the role expected to act, or APPROVED when the
 * chain is exhausted.
 */
export function nextApprovalStep(
  routing: ResolvedRouting,
  approvedRoles: readonly RoleCode[],
): { status: CaseStatus; nextRole: RoleCode | null } {
  const remaining = routing.approvalChain.filter((role) => !approvedRoles.includes(role));
  const nextRole = remaining[0] ?? null;
  return { status: statusForRole(nextRole ?? undefined), nextRole };
}

/**
 * Is this role entitled to approve at this point in the chain? Approving out of
 * order would let a Director's sign-off substitute for the Manager review the
 * policy requires, so order is enforced rather than merely displayed.
 */
export function assertApprovalTurn(
  routing: ResolvedRouting,
  approvedRoles: readonly RoleCode[],
  actingRole: RoleCode,
): void {
  const { nextRole } = nextApprovalStep(routing, approvedRoles);
  if (nextRole === null) {
    throw new BusinessRuleError(
      'APPROVAL_COMPLETE',
      'This case has already received every approval its value requires.',
    );
  }
  if (nextRole !== actingRole) {
    throw new BusinessRuleError(
      'APPROVAL_OUT_OF_ORDER',
      `This case awaits approval by ${nextRole}, not ${actingRole}.`,
    );
  }
}

/** Who issues the final letter for this amount (spec section 18)? */
export function resolveFinalLetterAuthority(
  rules: readonly FinalLetterRule[],
  amount: Numeric,
  at: Date = new Date(),
): FinalLetterRule {
  const value = dec(amount);
  const match = rules.filter((r) => isEffective(r, at)).find((r) => containsAmount(r, value));
  if (!match) {
    throw new ConfigurationError(
      `No final-letter authority is configured for the amount ${value.toFixed(2)}.`,
    );
  }
  return match;
}
