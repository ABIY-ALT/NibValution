'use server';

import { revalidatePath } from 'next/cache';
import { getRequestContext, requireActor } from '@/server/application/actor';
import { calculateValuation, recordSiteVisit } from '@/server/application/valuation-service';
import {
  deleteBuilding,
  deleteMechanicalItem,
  saveBuilding,
  saveCivilProperty,
  saveMachinery,
  saveMechanicalProperty,
  saveVehicle,
} from '@/server/application/property-service';
import {
  buildingSchema,
  civilPropertySchema,
  deleteItemSchema,
  machinerySchema,
  mechanicalPropertySchema,
  vehicleSchema,
} from '@/lib/validation/property';
import { calculateRequestSchema, siteVisitSchema } from '@/lib/validation/valuation';
import { isAppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import type { z } from 'zod';

/**
 * Valuation workspace server actions: property registration, the calculation
 * and site visits.
 *
 * Thin by design, like the case actions: parse, resolve the actor, delegate.
 * Every rule - who may edit, in which status, within which limits - is enforced
 * by the services below, so these behave the same as any future API route.
 */

export type WorkspaceActionState = {
  ok: boolean;
  message?: string;
  /** Distinct validation messages, for a form that shows them as a list. */
  messages?: string[];
  fieldErrors?: Record<string, string[]>;
  /** Set by a successful calculation. */
  result?: { marketValue: string; forcedSaleValue: string; version: number };
};

function invalid(issues: z.core.$ZodIssue[]): WorkspaceActionState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join('.') || 'form';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return {
    ok: false,
    message: 'Please correct the highlighted fields.',
    messages: [...new Set(issues.map((i) => i.message))],
    fieldErrors,
  };
}

async function run(
  caseId: string,
  label: string,
  operation: (ctx: Awaited<ReturnType<typeof getRequestContext>>) => Promise<void>,
  successMessage: string,
): Promise<WorkspaceActionState> {
  const ctx = await getRequestContext();
  try {
    await operation(ctx);
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.safeDetail ?? error.message };
    logger.error({ err: error, correlationId: ctx.correlationId, caseId }, `${label} failed`);
    return { ok: false, message: 'That could not be saved. Please try again.' };
  }
  revalidatePath(`/requests/${caseId}/valuation`);
  revalidatePath(`/requests/${caseId}`);
  return { ok: true, message: successMessage };
}

// ---------------------------------------------------------------------------
// Calculation
// ---------------------------------------------------------------------------

export async function calculateAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return {
      ok: false,
      message: 'The worksheet could not be read. Reload the page and try again.',
    };
  }

  const parsed = calculateRequestSchema.safeParse(payload);
  if (!parsed.success) return invalid(parsed.error.issues);

  const actor = await requireActor();
  const ctx = await getRequestContext();

  let result: WorkspaceActionState['result'];
  try {
    result = await calculateValuation(actor, parsed.data, ctx);
  } catch (error) {
    if (isAppError(error)) return { ok: false, message: error.safeDetail ?? error.message };
    logger.error(
      { err: error, correlationId: ctx.correlationId, caseId: parsed.data.caseId },
      'Valuation calculation failed',
    );
    return { ok: false, message: 'The valuation could not be calculated. Please try again.' };
  }

  revalidatePath(`/requests/${parsed.data.caseId}/valuation`);
  revalidatePath(`/requests/${parsed.data.caseId}`);
  revalidatePath('/dashboard');
  return { ok: true, message: 'Valuation calculated and saved.', result };
}

// ---------------------------------------------------------------------------
// Property registration
// ---------------------------------------------------------------------------

export async function saveCivilPropertyAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = civilPropertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Civil property save',
    (ctx) => saveCivilProperty(actor, parsed.data, ctx),
    'Property details saved.',
  );
}

export async function saveBuildingAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = buildingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Building save',
    (ctx) => saveBuilding(actor, parsed.data, ctx),
    'Building saved.',
  );
}

export async function deleteBuildingAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = deleteItemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Building delete',
    (ctx) => deleteBuilding(actor, parsed.data.caseId, parsed.data.itemId, ctx),
    'Building removed.',
  );
}

export async function saveMechanicalPropertyAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = mechanicalPropertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Mechanical property save',
    (ctx) => saveMechanicalProperty(actor, parsed.data, ctx),
    'Site details saved.',
  );
}

export async function saveVehicleAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = vehicleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Vehicle save',
    (ctx) => saveVehicle(actor, parsed.data, ctx),
    'Vehicle saved.',
  );
}

export async function saveMachineryAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = machinerySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Machinery save',
    (ctx) => saveMachinery(actor, parsed.data, ctx),
    'Machine saved.',
  );
}

export async function deleteMechanicalItemAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = deleteItemSchema.safeParse(Object.fromEntries(formData));
  const kind = formData.get('kind');
  if (!parsed.success) return invalid(parsed.error.issues);
  if (kind !== 'VEHICLE' && kind !== 'MACHINERY') {
    return { ok: false, message: 'Unknown item type.' };
  }
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Mechanical item delete',
    (ctx) => deleteMechanicalItem(actor, parsed.data.caseId, parsed.data.itemId, kind, ctx),
    'Item removed.',
  );
}

// ---------------------------------------------------------------------------
// Site visits
// ---------------------------------------------------------------------------

export async function recordSiteVisitAction(
  _prev: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = siteVisitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.issues);
  const actor = await requireActor();
  return run(
    parsed.data.caseId,
    'Site visit',
    (ctx) => recordSiteVisit(actor, parsed.data, ctx),
    'Site visit recorded.',
  );
}
