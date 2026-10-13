import { z } from 'zod';
import { ALL_PERMISSIONS, type PermissionCode } from '@/server/domain/rbac/permissions';

/**
 * Administration creation schemas.
 *
 * Shared with the client dialogs so a missing name is caught before a round
 * trip, but the server parses independently rather than trusting that the
 * client did (rule 4). Nothing here is a substitute for the permission check
 * in `admin-service`; a schema only establishes that the *shape* is sane.
 */

/**
 * The stable identifier a record is known by in the matrix, the seed and the
 * audit trail, derived from the name the administrator typed.
 *
 * Codes are derived rather than entered because the two would drift: an
 * administrator who names a role "Branch Reviewer" should not also have to
 * invent `BRANCH_REVIEWER`, and a free-text code field invites the typo that
 * makes a grant unreadable six months later. A collision is reported rather
 * than silently suffixed - two configuration entries whose names collapse to
 * one code are a mistake worth seeing.
 */
export function deriveCode(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

const name = z
  .string()
  .trim()
  .min(2, 'Enter a name of at least two characters.')
  .max(80, 'The name must be 80 characters or fewer.')
  .refine((value) => deriveCode(value).length >= 2, {
    message: 'The name must contain at least two letters or digits.',
  });

const description = z
  .string()
  .trim()
  .max(500, 'The description must be 500 characters or fewer.')
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null));

const isActive = z.boolean();

export const createRoleSchema = z.object({
  name,
  description,
  /**
   * Only codes from the catalogue are accepted. A posted code the application
   * does not know would sit in `role_permissions` granting nothing, and would
   * read as a grant in the matrix.
   */
  permissions: z
    .array(z.enum(ALL_PERMISSIONS as unknown as [PermissionCode, ...PermissionCode[]]))
    .default([]),
  isActive,
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const createPropertyCategorySchema = z.object({
  name,
  description,
  // Not optional: a property category is always civil or mechanical, and the
  // assignment rules filter on it.
  discipline: z.enum(['CIVIL', 'MECHANICAL']),
  isActive,
});
export type CreatePropertyCategoryInput = z.infer<typeof createPropertyCategorySchema>;

export const createRequestTypeSchema = z.object({
  name,
  description,
  isActive,
});
export type CreateRequestTypeInput = z.infer<typeof createRequestTypeSchema>;

export const createDocumentCategorySchema = z.object({
  name,
  description,
  isActive,
});
export type CreateDocumentCategoryInput = z.infer<typeof createDocumentCategorySchema>;

/** The three things the "Add" action on the categories page can create. */
export const CONFIGURATION_KINDS = [
  'PROPERTY_CATEGORY',
  'REQUEST_TYPE',
  'DOCUMENT_CATEGORY',
] as const;
export type ConfigurationKind = (typeof CONFIGURATION_KINDS)[number];
