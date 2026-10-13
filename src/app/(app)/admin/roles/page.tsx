import { ShieldAlert } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listPermissions, listRolesWithPermissions } from '@/server/application/admin-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { PERMISSIONS, type PermissionCode } from '@/server/domain/rbac/permissions';
import { CreateRoleDialog } from '@/components/admin/create-role-dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.ROLE_MANAGE)) {
    return <AccessDenied permission="role:manage" what="roles and permissions" />;
  }
  const [roles, permissions] = await Promise.all([
    listRolesWithPermissions(actor),
    listPermissions(actor),
  ]);

  // What this administrator may put on a new role: their own grants, and only
  // when they hold permission:manage. The service refuses anything wider, so
  // this narrows what is offered rather than deciding it.
  const grantable = actor.permissions.has(PERMISSIONS.PERMISSION_MANAGE)
    ? permissions.filter((permission) => actor.permissions.has(permission.code as PermissionCode))
    : [];

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Roles & Permissions"
        subtitle="Permissions are stored as data, not compiled into the application, so a grant can be changed without a deployment. Every check the server performs reads from this table."
        actions={
          <>
            <Badge variant="brand" size="lg">
              {roles.length} roles
            </Badge>
            <Badge variant="accent" size="lg">
              {permissions.length} permissions
            </Badge>
            <CreateRoleDialog permissions={grantable} />
          </>
        }
      />

      <Alert variant="warning">
        <ShieldAlert aria-hidden="true" />
        <AlertTitle>Administrators hold no valuation rights</AlertTitle>
        <AlertDescription>
          The ADMIN role deliberately carries no valuation, approval or signing permission. An
          administrator who could also approve a figure would break segregation of duties, and the
          audit trail would stop proving which valuation officer authorised it.
        </AlertDescription>
      </Alert>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((role) => (
          <Card key={role.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{role.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {role.isActive ? null : (
                    <Badge variant="inactive" size="sm">
                      Disabled
                    </Badge>
                  )}
                  {role.isSystem ? (
                    <Badge variant="brand" size="sm">
                      System
                    </Badge>
                  ) : null}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-[12.5px] leading-relaxed text-ink-3">
                {role.description ?? 'No description.'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="accent" size="sm">
                  {role.permissions.length} permissions
                </Badge>
                <Badge variant="default" size="sm">
                  {role._count.users} {role._count.users === 1 ? 'user' : 'users'}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
