'use client';

import { useState } from 'react';
import { updateThresholdChainAction } from '@/server/actions/admin-actions';
import { ActionForm } from '@/components/admin/action-form';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, type RoleCode } from '@/server/domain/shared/enums';

/** Roles that can appear in an approval chain, in escalation order. */
const CHAIN_ROLES: RoleCode[] = ['CHECKER', 'MAKER_MANAGER', 'DIRECTOR'];

/**
 * Editing an approval chain changes who must authorise a valuation, so it is
 * opened deliberately rather than presented as an always-live control, and the
 * save is confirmed. The order is fixed by escalation rather than by tick
 * order: a chain is only meaningful ascending.
 */
export function ThresholdChainForm({
  thresholdId,
  chain,
}: {
  thresholdId: string;
  chain: RoleCode[];
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
    );
  }

  return (
    <div className="w-56 rounded-md border border-border bg-card p-3 text-left">
      <ActionForm
        action={updateThresholdChainAction}
        label="Save chain"
        hidden={{ thresholdId }}
        confirm="Change who must approve valuations in this band? This takes effect immediately for cases reaching approval."
        className="w-full"
      >
        <fieldset className="mb-2 space-y-1">
          <legend className="mb-1 text-xs font-medium">Approvers, in order</legend>
          {CHAIN_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="chain"
                value={role}
                defaultChecked={chain.includes(role)}
                className="h-4 w-4 rounded border-input"
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </fieldset>
      </ActionForm>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-1 w-full"
        onClick={() => setOpen(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
