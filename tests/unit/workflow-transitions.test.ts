import { describe, expect, it } from 'vitest';
import {
  TRANSITIONS,
  assertTransitionAllowed,
  getTransition,
  isTransitionAllowedFrom,
  transitionsFrom,
  type WorkflowAction,
} from '@/server/domain/workflow/transitions';
import { CASE_STATUSES, type CaseStatus } from '@/server/domain/shared/enums';
import { WorkflowError } from '@/lib/errors';

describe('workflow state machine', () => {
  describe('table integrity', () => {
    it('declares every action exactly once', () => {
      const actions = TRANSITIONS.map((t) => t.action);
      expect(new Set(actions).size).toBe(actions.length);
    });

    it('references only known statuses', () => {
      const known = new Set<string>(CASE_STATUSES);
      for (const transition of TRANSITIONS) {
        for (const status of transition.from) {
          expect(known.has(status), `${transition.action} from ${status}`).toBe(true);
        }
        if (transition.to !== null) {
          expect(known.has(transition.to), `${transition.action} to ${transition.to}`).toBe(true);
        }
      }
    });

    it('gives every transition a permission and a description', () => {
      for (const transition of TRANSITIONS) {
        expect(transition.permission, transition.action).toBeTruthy();
        expect(transition.description.length, transition.action).toBeGreaterThan(10);
      }
    });

    it('leaves no status unreachable except DRAFT', () => {
      // DRAFT is the entry point, created rather than transitioned into.
      const reachable = new Set<string>(['DRAFT']);
      for (const transition of TRANSITIONS) {
        if (transition.to) reachable.add(transition.to);
        for (const target of transition.dynamicTargets ?? []) reachable.add(target);
      }

      const unreachable = CASE_STATUSES.filter((status) => !reachable.has(status));
      expect(unreachable).toEqual([]);
    });
  });

  describe('status preconditions', () => {
    it('permits submission only from DRAFT', () => {
      expect(isTransitionAllowedFrom('SUBMIT_REQUEST', 'DRAFT')).toBe(true);
      expect(isTransitionAllowedFrom('SUBMIT_REQUEST', 'ASSIGNED')).toBe(false);
    });

    it('permits assignment from REQUESTED and after a requester return', () => {
      expect(isTransitionAllowedFrom('ASSIGN_MAKER', 'REQUESTED')).toBe(true);
      expect(isTransitionAllowedFrom('ASSIGN_MAKER', 'AWAITING_REQUESTER')).toBe(true);
      expect(isTransitionAllowedFrom('ASSIGN_MAKER', 'CHECKING')).toBe(false);
    });

    it('names the current and the permitted statuses when refusing', () => {
      try {
        assertTransitionAllowed('SUBMIT_FOR_CHECKING', 'ASSIGNED');
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(WorkflowError);
        expect((error as Error).message).toContain('ASSIGNED');
        expect((error as Error).message).toContain('ON_PROGRESS');
      }
    });

    it('rejects an unknown action', () => {
      expect(() => getTransition('NOT_AN_ACTION' as WorkflowAction)).toThrow(WorkflowError);
    });
  });

  describe('guards required by the specification', () => {
    it('requires a mandatory comment on every return (section 33)', () => {
      expect(getTransition('RETURN_FOR_CORRECTION').guards).toContain('COMMENT_REQUIRED');
      expect(getTransition('REJECT').guards).toContain('COMMENT_REQUIRED');
    });

    it('requires a remark for not-visited and pending (section 16)', () => {
      expect(getTransition('MARK_NOT_VISITED').guards).toContain('REMARK_REQUIRED');
      expect(getTransition('MARK_PENDING').guards).toContain('REMARK_REQUIRED');
    });

    it('requires the checker to differ from the maker (assumption 2.2)', () => {
      expect(getTransition('ASSIGN_CHECKER').guards).toContain('CHECKER_DIFFERENT_FROM_MAKER');
    });

    it('excludes participants from approving and signing', () => {
      expect(getTransition('APPROVE_MANAGER').scope).toContain('NOT_PARTICIPANT');
      expect(getTransition('APPROVE_DIRECTOR').scope).toContain('NOT_PARTICIPANT');
      expect(getTransition('SIGN').scope).toContain('NOT_PARTICIPANT');
    });

    it('requires recent re-authentication before signing (section 19)', () => {
      expect(getTransition('SIGN').guards).toContain('RECENT_REAUTHENTICATION');
    });

    it('re-verifies the calculation before accepting a submission', () => {
      expect(getTransition('SUBMIT_FOR_CHECKING').guards).toContain('CALCULATION_COMPLETE');
      expect(getTransition('RESUBMIT').guards).toContain('CALCULATION_COMPLETE');
    });
  });

  describe('immutability after approval (rule 9)', () => {
    const terminal: CaseStatus[] = ['APPROVED', 'SIGNED', 'COMPLETED', 'ARCHIVED', 'CANCELLED'];

    it('never allows a case to be cancelled once approved', () => {
      for (const status of terminal) {
        expect(isTransitionAllowedFrom('CANCEL', status), status).toBe(false);
      }
    });

    it('never allows valuation editing from an approved status', () => {
      const editing: WorkflowAction[] = [
        'START_VALUATION',
        'SUBMIT_FOR_CHECKING',
        'RESUBMIT',
        'RETURN_FOR_CORRECTION',
      ];
      for (const action of editing) {
        for (const status of terminal) {
          expect(isTransitionAllowedFrom(action, status), `${action} from ${status}`).toBe(false);
        }
      }
    });

    it('offers nothing at all from ARCHIVED', () => {
      expect(transitionsFrom('ARCHIVED')).toEqual([]);
      expect(transitionsFrom('CANCELLED')).toEqual([]);
    });
  });

  describe('correction cycle', () => {
    it('returns to CHECKING on resubmission rather than restarting the case', () => {
      // Rework must re-enter where it left off; restarting from REQUESTED would
      // erase the checking already performed and distort the SLA.
      expect(getTransition('RESUBMIT').from).toEqual(['RETURNED_FOR_CORRECTION']);
      expect(getTransition('RESUBMIT').to).toBe('CHECKING');
    });

    it('allows a return from every approval gate, not only from checking', () => {
      const from = getTransition('RETURN_FOR_CORRECTION').from;
      expect(from).toContain('CHECKING');
      expect(from).toContain('PENDING_MANAGER_APPROVAL');
      expect(from).toContain('PENDING_DIRECTOR_APPROVAL');
    });
  });

  describe('task bookkeeping', () => {
    it('opens the next actor a task whenever work changes hands', () => {
      expect(getTransition('SUBMIT_REQUEST').opensTask).toBe('ASSIGN_MAKER');
      expect(getTransition('ASSIGN_MAKER').opensTask).toBe('PERFORM_VALUATION');
      expect(getTransition('SUBMIT_FOR_CHECKING').opensTask).toBe('ASSIGN_CHECKER');
      expect(getTransition('ASSIGN_CHECKER').opensTask).toBe('PERFORM_CHECKING');
      expect(getTransition('RETURN_FOR_CORRECTION').opensTask).toBe('CORRECT_VALUATION');
    });

    it('closes the task it fulfils', () => {
      expect(getTransition('ASSIGN_MAKER').closesTask).toBe('ASSIGN_MAKER');
      expect(getTransition('COMPLETE_CHECKING').closesTask).toBe('PERFORM_CHECKING');
      expect(getTransition('RESUBMIT').closesTask).toBe('CORRECT_VALUATION');
    });
  });
});

describe('conformance with the Scope of Work', () => {
  it('returns a checked case to the Maker for the cover page before approval', () => {
    // SoW: "Once the check is completed, the Checker Manager transfers the case
    // back to the Valuator Maker. The Valuator Maker prepares the cover page and
    // forwards the case to the Maker Manager."
    const complete = getTransition('COMPLETE_CHECKING');
    expect(complete.to).toBe('CHECKED');
    expect(complete.opensTask).toBe('GENERATE_COVER_PAGE');

    // Checking must not route straight to an approval gate.
    expect(complete.dynamicTargets ?? []).not.toContain('PENDING_MANAGER_APPROVAL');
  });

  it('lets only the Maker submit the cover page for approval', () => {
    const submit = getTransition('SUBMIT_FOR_APPROVAL');
    expect(submit.from).toEqual(['CHECKED']);
    expect(submit.roles).toEqual(['MAKER']);
    expect(submit.closesTask).toBe('GENERATE_COVER_PAGE');
    expect(submit.dynamicTargets).toContain('PENDING_MANAGER_APPROVAL');
    expect(submit.dynamicTargets).toContain('PENDING_DIRECTOR_APPROVAL');
  });

  it('gives return rights to every role the Scope of Work names', () => {
    // SoW: Checker returns to maker; Checker manager returns to maker/checker;
    // Director returns to manager/maker/checker.
    const roles = getTransition('RETURN_FOR_CORRECTION').roles;
    expect(roles).toContain('CHECKER');
    expect(roles).toContain('CHECKER_MANAGER');
    expect(roles).toContain('DIRECTOR');
  });
});
