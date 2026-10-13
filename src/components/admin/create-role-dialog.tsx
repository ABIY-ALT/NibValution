'use client';

import * as React from 'react';
import { useActionState, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { createRoleAction } from '@/server/actions/admin-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CodePreview,
  FormField,
  ResultBanner,
  StatusSelect,
  SubmitButton,
  initialActionState,
  useAcknowledgeableResult,
} from '@/components/admin/create-form';

export interface GrantablePermission {
  code: string;
  resource: string;
  description: string | null;
}

/**
 * Creating a role.
 *
 * The permission list offered here holds only the permissions the signed-in
 * administrator themselves holds. The server enforces the same rule - a posted
 * code beyond the actor's own grants is refused - but showing a permission that
 * would be rejected on submission is a worse way to say no.
 */
export function CreateRoleDialog({ permissions }: { permissions: GrantablePermission[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(createRoleAction, initialActionState);
  const [result, acknowledge] = useAcknowledgeableResult(state);
  const [name, setName] = useState('');
  // Remounts the fields after a successful save, so "Add another" starts blank
  // rather than pre-filled with the role that was just created.
  const [formKey, setFormKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const byResource = new Map<string, GrantablePermission[]>();
  for (const permission of permissions) {
    const bucket = byResource.get(permission.resource) ?? [];
    bucket.push(permission);
    byResource.set(permission.resource, bucket);
  }

  const created = result.ok && Boolean(result.message);

  function reset() {
    acknowledge();
    setName('');
    setSelected(new Set());
    setFormKey((key) => key + 1);
  }

  function toggle(code: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(code);
      else next.delete(code);
      return next;
    });
  }

  function toggleResource(items: GrantablePermission[], checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const item of items) {
        if (checked) next.add(item.code);
        else next.delete(item.code);
      }
      return next;
    });
  }

  return (
    <>
      <Tooltip content="Create a new role">
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Add Role
        </Button>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add a role</DialogTitle>
            <DialogDescription>
              A role is a named set of permissions. It is created as an ordinary role, not a system
              one, and holds nothing beyond what is ticked below.
            </DialogDescription>
          </DialogHeader>

          <form action={formAction} key={formKey} noValidate className="contents">
            <DialogBody className="space-y-5">
              <ResultBanner state={result} />

              <FormField
                id="role-name"
                label="Role name"
                required
                errors={result.fieldErrors?.name}
                hint={<CodePreview name={name} />}
              >
                <Input
                  id="role-name"
                  name="name"
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Branch Reviewer"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={Boolean(result.fieldErrors?.name)}
                />
              </FormField>

              <FormField
                id="role-description"
                label="Description"
                errors={result.fieldErrors?.description}
                hint="What this role is for, in one sentence. It is what the next administrator reads on the role card."
              >
                <Textarea
                  id="role-description"
                  name="description"
                  maxLength={500}
                  placeholder="Reviews valuations raised by their own branch before they are submitted."
                  aria-invalid={Boolean(result.fieldErrors?.description)}
                />
              </FormField>

              <fieldset>
                <legend className="mb-1.5 flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <ShieldCheck className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
                  Permissions
                  <Badge variant="accent" size="sm">
                    {selected.size} selected
                  </Badge>
                </legend>
                {result.fieldErrors?.permissions ? (
                  <p role="alert" className="mb-2 text-[11px] font-medium text-st-late">
                    {result.fieldErrors.permissions.join(' ')}
                  </p>
                ) : (
                  <p className="mb-2.5 text-[11px] leading-relaxed text-ink-3">
                    Grants can be changed later without a deployment. A role may be created with
                    none and given its permissions once its purpose is settled.
                  </p>
                )}

                <div className="max-h-72 space-y-4 overflow-y-auto rounded-(--radius-control) border border-line bg-surface-2/40 p-3.5">
                  {[...byResource.entries()].map(([resource, items]) => {
                    const allSelected = items.every((item) => selected.has(item.code));
                    return (
                      <div key={resource}>
                        <div className="mb-1.5 flex items-center justify-between gap-3">
                          <h4 className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
                            {resource}
                          </h4>
                          <button
                            type="button"
                            onClick={() => toggleResource(items, !allSelected)}
                            className="rounded text-[11px] font-semibold text-nib-gold-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-nib-gold-400"
                          >
                            {allSelected ? 'Clear' : 'Select all'}
                            <span className="sr-only"> {resource} permissions</span>
                          </button>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2">
                          {items.map((permission) => (
                            <label
                              key={permission.code}
                              className="flex cursor-pointer items-start gap-2.5 rounded-(--radius-control) border border-line bg-surface px-3 py-2 transition-colors hover:border-nib-gold-500/40 hover:bg-surface-2"
                            >
                              <input
                                type="checkbox"
                                name="permissions"
                                value={permission.code}
                                checked={selected.has(permission.code)}
                                onChange={(event) => toggle(permission.code, event.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-line-strong accent-nib-gold-500"
                              />
                              <span className="min-w-0">
                                <span className="tabular block truncate text-[12px] font-semibold text-ink">
                                  {permission.code}
                                </span>
                                {permission.description ? (
                                  <span className="block text-[11px] leading-snug text-ink-3">
                                    {permission.description}
                                  </span>
                                ) : null}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              <FormField
                id="role-status"
                label="Status"
                required
                errors={result.fieldErrors?.isActive}
                hint="A disabled role keeps its grants and its history but is offered nowhere new."
              >
                <StatusSelect id="role-status" />
              </FormField>
            </DialogBody>

            <DialogFooter>
              {created ? (
                <>
                  <Button type="button" variant="outline" onClick={reset}>
                    <Plus aria-hidden="true" />
                    Add another
                  </Button>
                  <Button type="button" onClick={() => setOpen(false)}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <SubmitButton
                    label="Create role"
                    pendingLabel="Creating…"
                    icon={<ShieldCheck aria-hidden="true" />}
                  />
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
