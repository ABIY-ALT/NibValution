'use client';

import { useActionState, useState } from 'react';
import {
  Ban,
  CircleUserRound,
  KeyRound,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  UnlockKeyhole,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  revokeUserSessionsAction,
  sendPasswordLinkAction,
  setUserActiveAction,
  setUserRolesAction,
  unlockUserAction,
  updateUserAction,
  type ActionResult,
  type LinkResult,
} from '@/server/actions/admin-actions';
import { ActionForm } from '@/components/admin/action-form';
import { ResultBanner } from '@/components/admin/create-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ROLE_LABELS, type Discipline, type RoleCode } from '@/server/domain/shared/enums';
import {
  DISCIPLINE_LABELS,
  PasswordLinkPanel,
  SendEmailCheckbox,
  UserDetailsFields,
  useFormAction,
  type UserFormOptions,
} from './user-form-parts';

export interface UserRowData {
  id: string;
  employeeId: string;
  fullName: string;
  email: string;
  phone: string | null;
  discipline: Discipline;
  isActive: boolean;
  isLocked: boolean;
  mustChange: boolean;
  /** False until the owner sets a password from their set-up link. */
  hasPassword: boolean;
  organization: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  roles: RoleCode[];
  makerCases: number;
  checkerCases: number;
  lastLogin: string;
  /** The same instant split in two, so the column stays narrow. Null when never. */
  lastLoginParts: { date: string; time: string } | null;
}

type Tab = 'details' | 'roles' | 'access';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'details', label: 'Details', icon: CircleUserRound },
  { id: 'roles', label: 'Roles', icon: ShieldCheck },
  { id: 'access', label: 'Sign-in & access', icon: KeyRound },
];

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

function StatusBadges({ user, short = false }: { user: UserRowData; short?: boolean }) {
  return (
    <>
      <Badge variant={user.isActive ? 'success' : 'inactive'} size="sm">
        {user.isActive ? 'Active' : 'Inactive'}
      </Badge>
      {user.isLocked ? (
        <Badge variant="danger" size="sm">
          Locked
        </Badge>
      ) : null}
      {user.hasPassword || !user.isActive ? null : (
        <Badge variant="warning" size="sm">
          {short ? 'Not set up' : 'Awaiting password set-up'}
        </Badge>
      )}
      {user.mustChange ? (
        <Badge variant="warning" size="sm">
          {short ? 'Must change' : 'Must change password'}
        </Badge>
      ) : null}
    </>
  );
}

function SectionHeading({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
      <Icon className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
      {children}
    </h3>
  );
}

/** One self-contained control on the access tab: what it does, then the button. */
function AccessSection({
  icon,
  title,
  children,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-(--radius-control) border border-line bg-surface p-4">
      <SectionHeading icon={icon}>{title}</SectionHeading>
      <p className="mb-3 text-[12px] leading-relaxed text-ink-2">{description}</p>
      {children}
    </section>
  );
}

const initialResult: ActionResult = { ok: false };
const initialLink: LinkResult = { ok: false };

function DetailsTab({ user, options }: { user: UserRowData; options: UserFormOptions }) {
  const [state, onSubmit, pending] = useFormAction(updateUserAction, initialResult);

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="userId" value={user.id} />
      <ResultBanner state={state} />

      <UserDetailsFields
        idPrefix={`user-${user.id}`}
        options={options}
        values={user}
        errors={state.fieldErrors}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="text-[11px] text-ink-3">
          <span className="tabular">{user.makerCases}</span> cases as maker ·{' '}
          <span className="tabular">{user.checkerCases}</span> as checker · last sign-in{' '}
          <span className="tabular">{user.lastLogin}</span>
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}

function RolesTab({
  user,
  allRoles,
  canAssignRoles,
}: {
  user: UserRowData;
  allRoles: { code: RoleCode; label: string }[];
  canAssignRoles: boolean;
}) {
  if (!canAssignRoles) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {user.roles.length === 0 ? (
            <span className="text-[12px] italic text-ink-3">No roles</span>
          ) : (
            user.roles.map((role) => (
              <Badge key={role} variant="brand" size="sm">
                {ROLE_LABELS[role] ?? role}
              </Badge>
            ))
          )}
        </div>
        <p className="text-[11px] text-ink-3">Changing roles needs the role-management permission.</p>
      </div>
    );
  }

  return (
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
        Changes take effect on the user&apos;s next request. A user may hold both manager roles; the
        workflow still forbids anyone from checking or approving a case they worked on.
      </p>
    </ActionForm>
  );
}

function PasswordLinkForm({ user }: { user: UserRowData }) {
  const [state, formAction, pending] = useActionState(sendPasswordLinkAction, initialLink);
  const label = user.hasPassword ? 'Send reset link' : 'Resend set-up link';

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="userId" value={user.id} />
      {state.ok && state.link ? (
        <PasswordLinkPanel link={state.link} />
      ) : (
        <SendEmailCheckbox id={`link-email-${user.id}`} email={user.email} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          <KeyRound aria-hidden="true" />
          {pending ? 'Sending…' : state.done ? 'Send another link' : label}
        </Button>
        {state.message ? (
          <span
            role="status"
            className={cn('text-[11px] font-semibold', state.ok ? 'text-st-done' : 'text-st-late')}
          >
            {state.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function AccessTab({ user, isSelf }: { user: UserRowData; isSelf: boolean }) {
  return (
    <div className="space-y-3">
      <AccessSection
        icon={KeyRound}
        title={user.hasPassword ? 'Password' : 'Password set-up'}
        description={
          isSelf ? (
            'This is your own account. Change your password from your account menu (your initials, top right) → Change password.'
          ) : !user.isActive ? (
            'The account is deactivated. Activate it before sending a password link.'
          ) : user.hasPassword ? (
            'Email the user a one-time link to choose a new password. Their current password keeps working until they use it; setting the new one signs them out everywhere and clears any lockout.'
          ) : (
            'This user has not set a password yet. Send a fresh set-up link if the first one expired or went astray - it replaces any earlier link.'
          )
        }
      >
        {isSelf || !user.isActive ? null : <PasswordLinkForm user={user} />}
      </AccessSection>

      {user.isLocked ? (
        <AccessSection
          icon={UnlockKeyhole}
          title="Locked out"
          description="The account was locked after too many failed sign-in attempts. Unlocking lets the user try again straight away with their current password."
        >
          <ActionForm
            action={unlockUserAction}
            label="Unlock account"
            variant="outline"
            hidden={{ userId: user.id }}
          />
        </AccessSection>
      ) : null}

      {isSelf ? null : (
        <AccessSection
          icon={LogOut}
          title="Sessions"
          description="End every session this user has open, on every device - for a lost laptop or a shared computer. The account stays active and they can sign in again."
        >
          <ActionForm
            action={revokeUserSessionsAction}
            label="Sign out of all devices"
            variant="outline"
            hidden={{ userId: user.id }}
          />
        </AccessSection>
      )}

      <AccessSection
        icon={user.isActive ? Ban : UserCheck}
        title="Account status"
        description={
          user.isActive
            ? isSelf
              ? 'You cannot deactivate your own account. Ask another administrator to do it.'
              : 'Deactivating ends every session and stops the user signing in. The account is kept, not deleted, so the audit trail keeps the identity behind everything they have done.'
            : 'Reactivating restores sign-in and clears any lockout. Their existing roles apply again on their next request.'
        }
      >
        {user.isActive && isSelf ? null : (
          <ActionForm
            action={setUserActiveAction}
            label={user.isActive ? 'Deactivate account' : 'Activate account'}
            variant={user.isActive ? 'destructive' : 'default'}
            confirm={
              user.isActive
                ? `Deactivate ${user.fullName}? They are signed out at once and cannot sign in until reactivated.`
                : undefined
            }
            hidden={{ userId: user.id, isActive: String(!user.isActive) }}
          />
        )}
      </AccessSection>
    </div>
  );
}

/**
 * The per-user editor: everything an administrator can do to one account,
 * behind three tabs.
 *
 * Each tab saves on its own, because each is a separately audited act - a role
 * grant changes what a person may authorise; a password reset ends their
 * sessions - and one combined "Save" would blur which of them happened.
 */
function ManageUserDialog({
  user,
  allRoles,
  options,
  isSelf,
  canAssignRoles,
  tab,
  onTabChange,
  open,
  onOpenChange,
}: {
  user: UserRowData;
  allRoles: { code: RoleCode; label: string }[];
  options: UserFormOptions;
  isSelf: boolean;
  canAssignRoles: boolean;
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tabId = (t: Tab) => `user-${user.id}-tab-${t}`;
  const panelId = `user-${user.id}-panel`;

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const index = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    if (!next) return;
    onTabChange(next.id);
    document.getElementById(tabId(next.id))?.focus();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="pb-0">
          <div className="flex items-start gap-3.5">
            <Avatar name={user.fullName} active={user.isActive} size="lg" />
            <div className="min-w-0">
              <DialogTitle className="truncate">
                {user.fullName}
                {isSelf ? <span className="ml-1.5 font-medium text-ink-3">(you)</span> : null}
              </DialogTitle>
              <DialogDescription className="truncate">
                <span className="tabular">{user.employeeId}</span> · {user.email}
              </DialogDescription>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <StatusBadges user={user} />
              </div>
            </div>
          </div>

          <div
            role="tablist"
            aria-label={`Manage ${user.fullName}`}
            onKeyDown={onKeyDown}
            className="-mb-px mt-4 flex gap-1 overflow-x-auto"
          >
            {TABS.map((t) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  id={tabId(t.id)}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onTabChange(t.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[12.5px] font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-nib-gold-500 text-ink'
                      : 'border-transparent text-ink-3 hover:text-ink-2',
                  )}
                >
                  <t.icon className="h-4 w-4" aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <DialogBody id={panelId} role="tabpanel" aria-labelledby={tabId(tab)}>
          {tab === 'details' ? <DetailsTab user={user} options={options} /> : null}
          {tab === 'roles' ? (
            <RolesTab user={user} allRoles={allRoles} canAssignRoles={canAssignRoles} />
          ) : null}
          {tab === 'access' ? <AccessTab user={user} isSelf={isSelf} /> : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One user row.
 *
 * Actions live behind a single overflow menu rather than a row of buttons;
 * each item opens the editor on the tab that does it, so a consequential act
 * is always one deliberate step away from a stray click.
 */
export function UserRow({
  user,
  allRoles,
  options,
  isSelf,
  canAssignRoles,
}: {
  user: UserRowData;
  allRoles: { code: RoleCode; label: string }[];
  options: UserFormOptions;
  isSelf: boolean;
  canAssignRoles: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('details');

  const openAt = (next: Tab) => {
    setTab(next);
    setOpen(true);
  };

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
                onClick={() => openAt('details')}
                title={`Edit ${user.fullName}`}
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
            {user.organization?.name ?? '—'}
            <span className="block text-[11px] leading-snug text-ink-3">
              {user.department?.name ?? '—'}
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
          <Badge
            variant={user.discipline === 'NONE' ? 'inactive' : 'accent'}
            size="sm"
            title={DISCIPLINE_LABELS[user.discipline]}
          >
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
            <StatusBadges user={user} short />
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

                <DropdownMenuItem onSelect={() => openAt('details')}>
                  <CircleUserRound aria-hidden="true" />
                  Edit details
                </DropdownMenuItem>

                <DropdownMenuItem onSelect={() => openAt('roles')}>
                  <ShieldCheck aria-hidden="true" />
                  Change roles
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  disabled={isSelf || !user.isActive}
                  onSelect={() => openAt('access')}
                >
                  <KeyRound aria-hidden="true" />
                  {user.hasPassword ? 'Send password reset link' : 'Resend set-up link'}
                </DropdownMenuItem>

                {user.isLocked ? (
                  <DropdownMenuItem onSelect={() => openAt('access')}>
                    <UnlockKeyhole aria-hidden="true" />
                    Unlock account
                  </DropdownMenuItem>
                ) : null}

                <DropdownMenuItem disabled={isSelf} onSelect={() => openAt('access')}>
                  <LogOut aria-hidden="true" />
                  Sign out of all devices
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive={user.isActive}
                  disabled={isSelf && user.isActive}
                  onSelect={() => openAt('access')}
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

      <ManageUserDialog
        user={user}
        allRoles={allRoles}
        options={options}
        isSelf={isSelf}
        canAssignRoles={canAssignRoles}
        tab={tab}
        onTabChange={setTab}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
