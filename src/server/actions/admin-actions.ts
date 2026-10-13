'use server';

import { revalidatePath } from 'next/cache';
import { getRequestContext, requireActor } from '@/server/application/actor';
import {
  createDocumentCategory,
  createPropertyCategory,
  createRequestType,
  createRole,
  publishParameterVersion,
  setPropertyCategoryActive,
  setRequestTypeActive,
  setUserActive,
  setUserDiscipline,
  setUserRoles,
  unlockUser,
  updateThresholdChain,
} from '@/server/application/admin-service';
import { addHoliday, removeHoliday, updateSlaPolicy } from '@/server/application/sla-service';
import { holidaySchema, slaPolicySchema } from '@/lib/validation/sla';
import { publishParameterSchema } from '@/lib/validation/parameters';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  DISCIPLINES,
  ROLE_CODES,
  type Discipline,
  type RoleCode,
} from '@/server/domain/shared/enums';
import { z } from 'zod';
import {
  CONFIGURATION_KINDS,
  createDocumentCategorySchema,
  createPropertyCategorySchema,
  createRequestTypeSchema,
  createRoleSchema,
  type ConfigurationKind,
} from '@/lib/validation/admin';

/**
 * Administration server actions.
 *
 * Every one re-resolves the actor and delegates to a service that asserts the
 * permission itself. Nothing here trusts that the caller reached the page
 * through the navigation - the same action is reachable by anyone who can post
 * to it, which is exactly why authorisation lives below this layer, not in it.
 */

export type ActionResult = {
  ok: boolean;
  message?: string;
  /** Field-keyed messages, set when a creation form fails validation. */
  fieldErrors?: Record<string, string[]>;
};

async function run(operation: () => Promise<void>, successMessage: string): Promise<ActionResult> {
  try {
    await operation();
    // Admin pages read live data; revalidating keeps the list consistent with
    // the change that was just committed.
    revalidatePath('/admin', 'layout');
    revalidatePath('/reports/sla');
    return { ok: true, message: successMessage };
  } catch (error) {
    if (isAppError(error)) {
      return { ok: false, message: error.safeDetail ?? error.message };
    }
    logger.error({ err: error }, 'Administration action failed');
    return { ok: false, message: 'The change could not be saved. Please try again.' };
  }
}

export async function setUserActiveAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const userId = String(formData.get('userId') ?? '');
  const isActive = formData.get('isActive') === 'true';

  return run(
    () => setUserActive(actor, userId, isActive, ctx),
    isActive
      ? 'The account has been activated.'
      : 'The account has been deactivated and its sessions ended.',
  );
}

export async function unlockUserAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const userId = String(formData.get('userId') ?? '');

  return run(() => unlockUser(actor, userId, ctx), 'The account lock has been cleared.');
}

export async function setUserRolesAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const userId = String(formData.get('userId') ?? '');

  // Only codes the domain recognises are accepted - a posted value that is not
  // a known role is dropped rather than passed through to the database.
  const roleCodes = formData
    .getAll('roles')
    .map(String)
    .filter((code): code is RoleCode => (ROLE_CODES as readonly string[]).includes(code));

  return run(() => setUserRoles(actor, userId, roleCodes, ctx), 'Roles updated.');
}

export async function setUserDisciplineAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const userId = String(formData.get('userId') ?? '');
  const raw = String(formData.get('discipline') ?? '');

  if (!(DISCIPLINES as readonly string[]).includes(raw)) {
    return { ok: false, message: 'That is not a valid discipline.' };
  }

  return run(() => setUserDiscipline(actor, userId, raw as Discipline, ctx), 'Discipline updated.');
}

export async function updateThresholdChainAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const thresholdId = String(formData.get('thresholdId') ?? '');

  const chain = formData
    .getAll('chain')
    .map(String)
    .filter((code): code is RoleCode => (ROLE_CODES as readonly string[]).includes(code));

  return run(
    () => updateThresholdChain(actor, thresholdId, chain, ctx),
    'The approval chain has been updated. Routing changes take effect immediately.',
  );
}

export async function setPropertyCategoryActiveAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const categoryId = String(formData.get('categoryId') ?? '');
  const isActive = formData.get('isActive') === 'true';

  return run(
    () => setPropertyCategoryActive(actor, categoryId, isActive, ctx),
    isActive ? 'Category enabled.' : 'Category disabled for new cases.',
  );
}

export async function setRequestTypeActiveAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const requestTypeId = String(formData.get('requestTypeId') ?? '');
  const isActive = formData.get('isActive') === 'true';

  return run(
    () => setRequestTypeActive(actor, requestTypeId, isActive, ctx),
    isActive ? 'Request type enabled.' : 'Request type disabled for new requests.',
  );
}

// ---------------------------------------------------------------------------
// Creating roles and configuration entries
// ---------------------------------------------------------------------------

/**
 * Turn a Zod failure into the field-keyed shape the dialogs render.
 *
 * The client validates the same schemas for immediate feedback; this is the
 * copy that decides, because the action is reachable by anyone who can post to
 * it whether or not the dialog was ever rendered for them.
 */
function invalid(error: z.ZodError): ActionResult {
  const flattened = z.flattenError(error);
  return {
    ok: false,
    message: 'Please correct the highlighted fields.',
    fieldErrors: flattened.fieldErrors as Record<string, string[]>,
  };
}

/** Checkbox and radio values arrive as strings; `undefined` means unchecked. */
function readBoolean(formData: FormData, field: string): boolean {
  return formData.get(field) === 'true';
}

export async function createRoleAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();

  const parsed = createRoleSchema.safeParse({
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
    permissions: formData.getAll('permissions').map(String),
    isActive: readBoolean(formData, 'isActive'),
  });
  if (!parsed.success) return invalid(parsed.error);

  return run(async () => {
    await createRole(actor, parsed.data, ctx);
  }, `The role "${parsed.data.name}" has been created.`);
}

/**
 * One action behind the categories page's "Add" button.
 *
 * The three kinds are separate tables with separate permissions, but a single
 * entry point keeps the dialog to one submission and keeps the permission
 * decision in the service rather than in the component that chose the form.
 */
export async function createConfigurationAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();

  const kind = String(formData.get('kind') ?? '');
  if (!(CONFIGURATION_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, message: 'Choose what you would like to add.' };
  }

  const common = {
    name: formData.get('name') ?? '',
    description: formData.get('description') ?? undefined,
    isActive: readBoolean(formData, 'isActive'),
  };

  switch (kind as ConfigurationKind) {
    case 'PROPERTY_CATEGORY': {
      const parsed = createPropertyCategorySchema.safeParse({
        ...common,
        discipline: formData.get('discipline') ?? '',
      });
      if (!parsed.success) return invalid(parsed.error);
      return run(async () => {
        await createPropertyCategory(actor, parsed.data, ctx);
      }, `The property category "${parsed.data.name}" has been created.`);
    }

    case 'REQUEST_TYPE': {
      const parsed = createRequestTypeSchema.safeParse(common);
      if (!parsed.success) return invalid(parsed.error);
      return run(async () => {
        await createRequestType(actor, parsed.data, ctx);
      }, `The request type "${parsed.data.name}" has been created.`);
    }

    case 'DOCUMENT_CATEGORY': {
      const parsed = createDocumentCategorySchema.safeParse(common);
      if (!parsed.success) return invalid(parsed.error);
      return run(async () => {
        await createDocumentCategory(actor, parsed.data, ctx);
      }, `The document category "${parsed.data.name}" has been created.`);
    }
  }
}

// ---------------------------------------------------------------------------
// Valuation parameters
// ---------------------------------------------------------------------------

export async function publishParameterAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();

  // Table rows arrive as two parallel lists, one input pair per row.
  const entries = formData.getAll('tableEntry').map(String);
  const values = formData.getAll('tableValue').map(String);

  const parsed = publishParameterSchema.safeParse({
    setCode: formData.get('setCode') ?? '',
    key: formData.get('key') ?? '',
    name: formData.get('name') ?? '',
    type: formData.get('type') ?? '',
    numericValue: formData.get('numericValue') ?? undefined,
    table: entries.map((entry, index) => ({ entry, value: values[index] ?? '' })),
    unit: formData.get('unit') ?? undefined,
    discipline: formData.get('discipline') ?? 'ALL',
    notes: formData.get('notes') ?? undefined,
    effectiveFrom: formData.get('effectiveFrom') ?? '',
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error);

  let version = 0;
  const result = await run(async () => {
    ({ version } = await publishParameterVersion(actor, parsed.data, ctx));
  }, '');
  if (!result.ok) return result;

  return {
    ok: true,
    message: `Published version ${version} of ${parsed.data.setCode}. It applies to valuations dated ${parsed.data.effectiveFrom} or later; earlier valuations keep the version they used.`,
  };
}

// ---------------------------------------------------------------------------
// SLA policy and holiday calendar
// ---------------------------------------------------------------------------

export async function updateSlaPolicyAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();

  const parsed = slaPolicySchema.safeParse({
    totalWorkingDays: formData.get('totalWorkingDays') ?? '',
    warningPercent: formData.get('warningPercent') ?? '',
    workingDaysOfWeek: formData.getAll('workingDaysOfWeek').map(String),
    countCalendarDays: readBoolean(formData, 'countCalendarDays'),
  });
  if (!parsed.success) return invalid(parsed.error);

  return run(
    () => updateSlaPolicy(actor, parsed.data, ctx),
    'The SLA policy has been saved. Open cases have been re-evaluated against it.',
  );
}

export async function addHolidayAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();

  const parsed = holidaySchema.safeParse({
    date: formData.get('date') ?? '',
    name: formData.get('name') ?? '',
    isRecurring: readBoolean(formData, 'isRecurring'),
  });
  if (!parsed.success) return invalid(parsed.error);

  return run(
    () => addHoliday(actor, parsed.data, ctx),
    `${parsed.data.name} has been added to the calendar.`,
  );
}

export async function removeHolidayAction(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const actor = await requireActor();
  const ctx = await getRequestContext();
  const holidayId = String(formData.get('holidayId') ?? '');

  return run(() => removeHoliday(actor, holidayId, ctx), 'The holiday has been removed.');
}
