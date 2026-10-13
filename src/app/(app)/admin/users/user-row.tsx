'use client';

import { useState } from 'react';
import {
  Ban,
  CircleUserRound,
  MoreHorizontal,
  ShieldCheck,
  UnlockKeyhole,
  UserCheck,
  Wrench,
} from 'lucide-react';
import {
  setUserActiveAction,
  setUserDisciplineAction,
  setUserRolesAction,
  unlockUserAction,
} from '@/server/actions/admin-actions';
import { ActionForm } from '@/components/admin/action-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { TD, TR } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  DISCIPLINES,
  ROLE_LABELS,
  type Discipline,
  type RoleCode,
} from '@/server/domain/shared/enums';

export interface UserRowData {
  id: string;
  employeeId: string;
  fullName: string;
  email: string;
  discipline: Discipline;
  isActive: boolean;
  isLocked: boolean;
  mustChange: boolean;
  organization: string | null;
  department: string | null;
  roles: RoleCode[];
  makerCases: number;
  checkerCases: number;
  lastLogin: string;
  /** The same instant split in two, so the column stays narrow. Null when never. */
  lastLoginParts: { date: string; time: string } | null;
}

/** Initials plate, so a long directory scans by shape as well as by name. */
function Avatar({
  name,
  active,
  size = 'sm',
}: {
  name: string;
  active: boolean;
  size?: 'sm' | 'lg';
}) {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'NB';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-bold',
        size === 'lg' ? 'h-12 w-12 text-[15px]' : 'h-9 w-9 text-[11px]',
        active
          ? 'bg-gradient-to-br from-nib-brown-700 to-nib-brown-900 text-nib-gold-200'
          : 'border border-line bg-surface-2 text-ink-3',
      )}
    >
      {initials}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2.5 last:border-0">
      <dt className="text-[11px] font-semibold text-ink-3">{label}</dt>
      <dd className="text-[12.5px] font-medium text-ink">{children}</dd>
    </div>
  );
}

/**
 * The per-user editor.
 *
 * Roles and discipline are the two things an administrator can actually change
 * about an account, and each is its own server action, so the panel holds two
 * independent forms rather than one combined save. They are deliberate,
 * separately audited acts: a role grant changes what a person may authorise.
 */
function EditProfileDialog({
  user,
  allRoles,
  open,
  onOpenChange,
}: {
  user: UserRowData;
  allRoles: { code: RoleCode; label: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3.5">
            <Avatar name={user.fullName} active={user.isActive} size="lg" />
            <div className="min-w-0">
              <DialogTitle>{user.fullName}</DialogTitle>
              <DialogDescription>
                <span className="tabular">{user.employeeId}</span> · {user.email}
              </DialogDescription>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant={user.isActive ? 'success' : 'inactive'} size="sm">
                  {user.isActive ? 'Active' : 'Inactive'}
                </Badge>
                {user.isLocked ? (
                  <Badge variant="danger" size="sm">
                    Locked
                  </Badge>
                ) : null}
                {user.mustChange ? (
                  <Badge variant="warning" size="sm">
                    Must change password
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-7">
          <section>
            <h3 className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
              <CircleUserRound className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Profile
            </h3>
            <dl>
              <DetailRow label="Organisational unit">{user.organization ?? '—'}</DetailRow>
              <DetailRow label="Department">{user.department ?? '—'}</DetailRow>
              <DetailRow label="Cases as maker">
                <span className="tabular">{user.makerCases}</span>
              </DetailRow>
              <DetailRow label="Cases as checker">
                <span className="tabular">{user.checkerCases}</span>
              </DetailRow>
              <DetailRow label="Last sign-in">
                <span className="tabular">{user.lastLogin}</span>
              </DetailRow>
            </dl>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Name, unit and department come from the staff record and are not edited here.
            </p>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
              <ShieldCheck className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Roles
            </h3>
            <ActionForm
              action={setUserRolesAction}
              label="Save roles"
              hidden={{ userId: user.id }}
              className="w-full"
            >
              <fieldset className="mb-3 grid gap-1.5 sm:grid-cols-2">
                <legend className="sr-only">Roles for {user.fullName}</legend>
                {allRoles.map((role) => (
                  <label
                    key={role.code}
                    className="flex cursor-pointer items-center gap-2.5 rounded-(--radius-control) border border-line bg-surface px-3 py-2 text-[12.5px] transition-colors hover:border-nib-gold-500/40 hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      name="roles"
                      value={role.code}
                      defaultChecked={user.roles.includes(role.code)}
                      className="h-4 w-4 shrink-0 rounded border-line-strong accent-nib-gold-500"
                    />
                    <span className="min-w-0 truncate">{role.label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
                A user may hold both manager roles. The workflow engine still forbids anyone from
                checking or approving a case they worked on.
              </p>
            </ActionForm>
          </section>

          <section>
            <h3 className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
              <Wrench className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
              Discipline
            </h3>
            <ActionForm
              action={setUserDisciplineAction}
              label="Save discipline"
              hidden={{ userId: user.id }}
              className="w-full"
            >
              <Select
                name="discipline"
                defaultValue={user.discipline}
                aria-label={`Discipline for ${user.fullName}`}
                className="mb-3"
              >
                {DISCIPLINES.map((discipline) => (
                  <option key={discipline} value={discipline}>
                    {discipline}
                  </option>
                ))}
              </Select>
              <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
                Assignment is filtered by discipline: a civil valuator cannot be given a mechanical
                case, and the server refuses a mismatched assignment.
              </p>
            </ActionForm>
          </section>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One user row.
 *
 * Actions live behind a single overflow menu rather than as a row of buttons
 * and an inline disclosure. The editor was previously an expanding panel that
 * pushed the whole table down and put a role grant one stray click away; a menu
 * keeps the register scannable and makes opening the editor an explicit act.
 */
export function UserRow({
  user,
  allRoles,
  isSelf,
}: {
  user: UserRowData;
  allRoles: { code: RoleCode; label: string }[];
  isSelf: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <TR>
        {/* Every text column has a width cap. Test and service accounts carry
            identifiers far longer than a person's, and an unbroken line in an
            auto-width table widens the whole register until it scrolls
            sideways and hides the first column. Capped cells truncate instead,
            with the full value on hover. */}
        <TD>
          <div className="flex items-center gap-3">
            <Avatar name={user.fullName} active={user.isActive} />
            <div className="min-w-0 max-w-[14rem]">
              <button
                type="button"
                onClick={() => setEditing(true)}
                title={user.fullName}
                className="block max-w-full truncate text-left text-[13px] font-bold text-ink transition-colors hover:text-nib-gold-700 hover:underline dark:hover:text-nib-gold-400"
              >
                {user.fullName}
                {isSelf ? <span className="ml-1.5 font-medium text-ink-3">(you)</span> : null}
              </button>
              <span className="block truncate text-[11.5px] text-ink-2" title={user.email}>
                {user.email}
              </span>
              <span
                className="tabular block truncate text-[10.5px] text-ink-3"
                title={user.employeeId}
              >
                {user.employeeId}
              </span>
            </div>
          </div>
        </TD>

        <TD className="text-[12.5px]">
          <div className="max-w-[11rem]">
            {user.organization ?? '—'}
            <span className="block text-[11px] leading-snug text-ink-3">
              {user.department ?? '—'}
            </span>
          </div>
        </TD>

        <TD>
          <div className="flex max-w-[11rem] flex-wrap gap-1">
            {user.roles.length === 0 ? (
              <span className="text-[11px] italic text-ink-3">No roles</span>
            ) : (
              user.roles.map((role) => (
                <Badge key={role} variant="brand" size="sm">
                  {ROLE_LABELS[role] ?? role}
                </Badge>
              ))
            )}
          </div>
        </TD>

        <TD>
          <Badge variant={user.discipline === 'NONE' ? 'inactive' : 'accent'} size="sm">
            {user.discipline}
          </Badge>
        </TD>

        <TD className="whitespace-nowrap text-center text-[12px]">
          <span className="tabular" title="Cases as maker / as checker">
            {user.makerCases} / {user.checkerCases}
          </span>
        </TD>

        <TD className="tabular whitespace-nowrap text-[12px] text-ink-2">
          {user.lastLoginParts ? (
            <>
              {user.lastLoginParts.date}
              <span className="block text-[11px] text-ink-3">{user.lastLoginParts.time} UTC</span>
            </>
          ) : (
            <span className="text-ink-3">Never</span>
          )}
        </TD>

        <TD>
          <div className="flex flex-col items-start gap-1">
            <Badge variant={user.isActive ? 'success' : 'inactive'} size="sm">
              {user.isActive ? 'Active' : 'Inactive'}
            </Badge>
            {user.isLocked ? (
              <Badge variant="danger" size="sm">
                Locked
              </Badge>
            ) : null}
            {user.mustChange ? (
              <Badge variant="warning" size="sm">
                Must change
              </Badge>
            ) : null}
          </div>
        </TD>

        <TD>
          <div className="flex justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.fullName}`}>
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent>
                <DropdownMenuLabel>{user.fullName}</DropdownMenuLabel>
                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <CircleUserRound aria-hidden="true" />
                  Edit profile
                </DropdownMenuItem>

                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <ShieldCheck aria-hidden="true" />
                  Roles &amp; discipline
                </DropdownMenuItem>

                {user.isLocked ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setConfirming(true)}>
                      <UnlockKeyhole aria-hidden="true" />
                      Unlock account
                    </DropdownMenuItem>
                  </>
                ) : null}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive={user.isActive}
                  disabled={isSelf && user.isActive}
                  onSelect={() => setConfirming(true)}
                >
                  {user.isActive ? (
                    <>
                      <Ban aria-hidden="true" />
                      Deactivate account
                    </>
                  ) : (
                    <>
                      <UserCheck aria-hidden="true" />
                      Activate account
                    </>
                  )}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TD>
      </TR>

      <EditProfileDialog user={user} allRoles={allRoles} open={editing} onOpenChange={setEditing} />

      {/* The activate/deactivate and unlock forms live in their own dialog: a
          server action needs a real form submission, and the menu unmounts the
          moment an item is chosen. */}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{user.isActive ? 'Deactivate account' : 'Account access'}</DialogTitle>
            <DialogDescription>{user.fullName}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            {user.isActive ? (
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                This ends every live session for{' '}
                <strong className="font-semibold text-ink">{user.fullName}</strong> immediately and
                prevents them signing in. The account is retained, not deleted, so the audit trail
                keeps the identity behind everything they have already done.
              </p>
            ) : (
              <p className="text-[12.5px] leading-relaxed text-ink-2">
                Reactivating restores sign-in and clears any failed-attempt lockout. The
                account&apos;s existing roles take effect on their next request.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {user.isLocked ? (
                <ActionForm
                  action={unlockUserAction}
                  label="Unlock account"
                  variant="outline"
                  hidden={{ userId: user.id }}
                />
              ) : null}

              <ActionForm
                action={setUserActiveAction}
                label={user.isActive ? 'Deactivate' : 'Activate'}
                variant={user.isActive ? 'destructive' : 'default'}
                hidden={{ userId: user.id, isActive: String(!user.isActive) }}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
