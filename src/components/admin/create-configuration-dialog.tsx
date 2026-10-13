'use client';

import * as React from 'react';
import { useActionState, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  ChevronRight,
  FileText,
  FolderPlus,
  Paperclip,
  Plus,
} from 'lucide-react';
import { createConfigurationAction } from '@/server/actions/admin-actions';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
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
import type { ConfigurationKind } from '@/lib/validation/admin';

/**
 * The three things this page can add, in the order the page lists them.
 *
 * Each names the permission the server will check, so a kind the administrator
 * cannot create is never offered: `createConfigurationAction` refuses it
 * either way, but a dialog that leads somewhere closed is worse than one that
 * does not offer the route.
 */
const KINDS: {
  kind: ConfigurationKind;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
}[] = [
  {
    kind: 'PROPERTY_CATEGORY',
    label: 'Property category',
    blurb: 'What a property is classified as when it is valued — civil or mechanical.',
    icon: Building2,
  },
  {
    kind: 'REQUEST_TYPE',
    label: 'Request type',
    blurb: 'Why a valuation was asked for. Chosen when a request is raised.',
    icon: FileText,
  },
  {
    kind: 'DOCUMENT_CATEGORY',
    label: 'Document category',
    blurb: 'What an uploaded document is. Applies to every discipline unless narrowed later.',
    icon: Paperclip,
  },
];

export function CreateConfigurationDialog({ allowed }: { allowed: ConfigurationKind[] }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ConfigurationKind | null>(null);
  const [name, setName] = useState('');
  const [formKey, setFormKey] = useState(0);
  const [state, formAction] = useActionState(createConfigurationAction, initialActionState);
  const [result, acknowledge] = useAcknowledgeableResult(state);

  const choices = KINDS.filter((choice) => allowed.includes(choice.kind));
  if (choices.length === 0) return null;

  const chosen = choices.find((choice) => choice.kind === kind) ?? null;
  const created = result.ok && Boolean(result.message);

  function clearForm() {
    acknowledge();
    setName('');
    setFormKey((key) => key + 1);
  }

  /** Back to the chooser, so a second entry need not be the same kind. */
  function restart() {
    clearForm();
    setKind(null);
  }

  return (
    <>
      <Tooltip content="Add a new category or type">
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden="true" />
          Add
        </Button>
      </Tooltip>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) restart();
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {chosen ? `Add a ${chosen.label.toLowerCase()}` : 'Add to configuration'}
            </DialogTitle>
            <DialogDescription>
              {chosen
                ? chosen.blurb
                : 'Choose what you would like to add. Each is configuration rather than code, and takes effect without a deployment.'}
            </DialogDescription>
          </DialogHeader>

          {chosen === null ? (
            <>
              <DialogBody>
                <ul className="space-y-2">
                  {choices.map((choice) => (
                    <li key={choice.kind}>
                      <button
                        type="button"
                        onClick={() => setKind(choice.kind)}
                        className="flex w-full items-center gap-3.5 rounded-(--radius-control) border border-line bg-surface px-4 py-3.5 text-left shadow-card transition-colors hover:border-nib-gold-500/50 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) bg-nib-gold-100 text-nib-gold-700 dark:bg-nib-gold-500/15 dark:text-nib-gold-400">
                          <choice.icon className="h-4 w-4" aria-hidden={true} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-bold text-ink">
                            {choice.label}
                          </span>
                          <span className="block text-[11.5px] leading-snug text-ink-3">
                            {choice.blurb}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden={true} />
                      </button>
                    </li>
                  ))}
                </ul>
              </DialogBody>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ) : (
            <form action={formAction} key={formKey} noValidate className="contents">
              <input type="hidden" name="kind" value={chosen.kind} />

              <DialogBody className="space-y-5">
                <ResultBanner state={result} />

                <FormField
                  id="config-name"
                  label="Name"
                  required
                  errors={result.fieldErrors?.name}
                  hint={<CodePreview name={name} />}
                >
                  <Input
                    id="config-name"
                    name="name"
                    maxLength={80}
                    autoComplete="off"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={Boolean(result.fieldErrors?.name)}
                  />
                </FormField>

                {chosen.kind === 'PROPERTY_CATEGORY' ? (
                  <FormField
                    id="config-discipline"
                    label="Discipline"
                    required
                    errors={result.fieldErrors?.discipline}
                    hint="Assignment is filtered by discipline, so a category belongs to one or the other."
                  >
                    <Select
                      id="config-discipline"
                      name="discipline"
                      defaultValue="CIVIL"
                      aria-invalid={Boolean(result.fieldErrors?.discipline)}
                    >
                      <option value="CIVIL">Civil</option>
                      <option value="MECHANICAL">Mechanical</option>
                    </Select>
                  </FormField>
                ) : null}

                <FormField
                  id="config-description"
                  label="Description"
                  errors={result.fieldErrors?.description}
                  hint="What this is for, in one sentence."
                >
                  <Textarea
                    id="config-description"
                    name="description"
                    maxLength={500}
                    aria-invalid={Boolean(result.fieldErrors?.description)}
                  />
                </FormField>

                <FormField
                  id="config-status"
                  label="Status"
                  required
                  errors={result.fieldErrors?.isActive}
                  hint="Disabling hides a value from new cases only. Existing cases keep what they were created with."
                >
                  <StatusSelect id="config-status" />
                </FormField>
              </DialogBody>

              <DialogFooter>
                {created ? (
                  <>
                    <Button type="button" variant="outline" onClick={restart}>
                      <FolderPlus aria-hidden="true" />
                      Add another
                    </Button>
                    <Button type="button" onClick={() => setOpen(false)}>
                      Done
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="ghost" onClick={restart}>
                      <ArrowLeft aria-hidden="true" />
                      Back
                    </Button>
                    <SubmitButton
                      label={`Create ${chosen.label.toLowerCase()}`}
                      pendingLabel="Creating…"
                      icon={<FolderPlus aria-hidden="true" />}
                    />
                  </>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
