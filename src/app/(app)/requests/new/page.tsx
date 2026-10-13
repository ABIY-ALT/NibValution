import { TriangleAlert } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import { listActiveRequestTypes } from '@/server/application/case-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { RequestForm } from './request-form';

export const dynamic = 'force-dynamic';

export default async function NewRequestPage() {
  const actor = await requireActor();

  if (!actor.permissions.has(PERMISSIONS.CASE_CREATE)) {
    return <AccessDenied permission="case:create" what="raising a valuation request" />;
  }

  // Request types are configuration, so the form offers exactly what an
  // administrator has enabled - never a hard-coded list (spec section 37).
  const requestTypes = await listActiveRequestTypes();

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Valuation"
        title="New Valuation Request"
        subtitle="Raise a request for the Property Valuation Department. Your branch, the receiving department and the case number are set automatically."
      />

      {requestTypes.length === 0 ? (
        <Alert variant="warning">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>No request types are enabled</AlertTitle>
          <AlertDescription>
            An administrator must enable at least one request type before requests can be raised.
          </AlertDescription>
        </Alert>
      ) : (
        <RequestForm requestTypes={requestTypes} />
      )}
    </div>
  );
}
