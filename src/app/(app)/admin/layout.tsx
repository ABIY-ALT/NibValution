import { requireActor } from '@/server/application/actor';
import { AccessDenied } from '@/components/admin/access-denied';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';

/**
 * Administration section gate.
 *
 * A first, coarse check that the caller holds at least one administrative
 * permission, rendering a plain refusal rather than throwing - a user who lands
 * here without rights should see an explanation, not a server error.
 *
 * This is a courtesy, not the boundary. Every page below re-checks the specific
 * permission it needs, and every service function asserts it again and throws.
 * Reaching this layout grants nothing.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();

  const adminPermissions = [
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.ROLE_MANAGE,
    PERMISSIONS.THRESHOLD_UPDATE,
    PERMISSIONS.PARAMETER_UPDATE,
    PERMISSIONS.CATEGORY_UPDATE,
    PERMISSIONS.SLA_CONFIG,
    PERMISSIONS.AUDIT_READ,
  ];

  if (!adminPermissions.some((permission) => actor.permissions.has(permission))) {
    return (
      <AccessDenied permission="an administration permission" what="the administration area" />
    );
  }

  // Anchored to the rail like every other page, not centred: centring opened a
  // gap beside the rail that widened with the window.
  return <div className="max-w-7xl">{children}</div>;
}
