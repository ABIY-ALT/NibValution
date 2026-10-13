import { describe, expect, it } from 'vitest';
import {
  auditActionLabel,
  auditEntityLabel,
  describeAudit,
  humanize,
  roleNames,
} from '@/lib/audit-describe';

const CASE_ID = '7a4c1a52-1f1e-4d8b-9d7e-3c6f0b2a9e11';
const USER_ID = 'ad189081-5da9-4780-98f9-e94fa3768754';

const lookups = {
  caseNumbers: { [CASE_ID]: 'PV-2026-000123' },
  userNames: { [USER_ID]: 'Yonas Bekele' },
};

function row(
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown,
) {
  return describeAudit({ action, entity, entityId, before, after }, lookups);
}

describe('audit descriptions', () => {
  it('names a workflow step and its status change, with the case number', () => {
    const d = row(
      'CASE_TRANSITIONED',
      'ValuationCase',
      CASE_ID,
      { status: 'ASSIGNED', version: 4 },
      { action: 'CANCEL', status: 'CANCELLED', comment: 'Customer withdrew', version: 5 },
    );
    expect(d.category).toBe('case');
    expect(d.summary).toBe('Cancelled the case');
    expect(d.detail).toBe('Assigned → Cancelled · “Customer withdrew”');
    expect(d.caseNumber).toBe('PV-2026-000123');
    expect(d.caseId).toBe(CASE_ID);
  });

  it('resolves the case of a record that only carries it in its snapshot', () => {
    const d = row('DOCUMENT_UPLOADED', 'PropertyDocument', null, null, {
      caseId: CASE_ID,
      filename: 'deed.pdf',
      category: 'LHC',
    });
    expect(d.summary).toBe('Uploaded “deed.pdf”');
    expect(d.caseNumber).toBe('PV-2026-000123');
  });

  it('describes a created configuration entry by its name, not its JSON', () => {
    const d = row('CONFIGURATION_CHANGED', 'DocumentCategory', 'x', null, {
      code: 'SMOKE_DEED',
      name: 'Smoke Deed',
      isActive: true,
    });
    expect(d.category).toBe('settings');
    expect(d.summary).toBe('Created document category “Smoke Deed”');
  });

  it('describes enabling and disabling', () => {
    const d = row(
      'CONFIGURATION_CHANGED',
      'RequestType',
      'x',
      { code: 'NEW', isActive: true },
      { code: 'NEW', isActive: false },
    );
    expect(d.summary).toBe('Disabled request type “NEW”');
  });

  it('names the account a role change was made to, and what was added', () => {
    const d = row('ROLE_GRANTED', 'User', USER_ID, { roles: [] }, { roles: ['ADMIN'] });
    expect(d.summary).toBe('Changed Yonas Bekele’s roles');
    expect(d.detail).toBe('Added System Administrator');
  });

  it('explains a failed sign-in without exposing a stack of fields', () => {
    const d = row('LOGIN_FAILURE', 'User', null, null, {
      reason: 'UNKNOWN_ACCOUNT',
      identifier: 'ADMIN.USER',
    });
    expect(d.category).toBe('security');
    expect(d.detail).toBe('No account matches “ADMIN.USER”');
  });

  it('describes a parameter publication', () => {
    const d = row('CONFIGURATION_CHANGED', 'ValuationParameterSet', 'x', null, {
      version: 2,
      key: 'cost_approach.mcf',
      parameterName: 'MCF',
      parameterAdded: false,
      reason: 'Confirmed by PVD',
    });
    expect(d.summary).toBe('Published valuation parameters version 2');
    expect(d.detail).toBe('Changed “MCF” — Confirmed by PVD');
  });

  it('falls back to readable words for an action it does not know', () => {
    const d = row('SOMETHING_NEW', 'WidgetThing', null, { a: 1 }, { a: 2 });
    expect(d.summary).toBe('Something new — widget thing');
    expect(d.detail).toBe('Changed a');
  });

  it('never throws on malformed snapshots', () => {
    for (const action of [
      'CASE_TRANSITIONED',
      'ROLE_GRANTED',
      'USER_UPDATED',
      'CALCULATION_PERFORMED',
    ]) {
      expect(() => row(action, 'User', 'not-a-uuid', 'oops', [1, 2, 3])).not.toThrow();
    }
  });
});

describe('audit labels', () => {
  it('turns codes into words', () => {
    expect(humanize('SUBMIT_REQUEST')).toBe('Submit request');
    expect(humanize('landHoldingRight')).toBe('Land holding right');
    expect(auditActionLabel('LOGIN_SUCCESS')).toBe('Signed in');
    expect(auditEntityLabel('ValuationCase')).toBe('Valuation case');
    expect(auditEntityLabel('SomeNewEntity')).toBe('Some new entity');
  });

  it('names the roles stored as a comma-joined code list', () => {
    expect(roleNames('ADMIN,PROCESS_OWNER')).toBe('System Administrator, Process Owner');
    expect(roleNames(null)).toBeNull();
  });
});
