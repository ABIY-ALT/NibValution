import { Info, KeyRound, Lock, UserCheck, Users, UserX } from 'lucide-react';
import { requireActor } from '@/server/application/actor';
import {
  listRolesForAssignment,
  listUsers,
  type UserListFilter,
} from '@/server/application/admin-service';
import { AccessDenied } from '@/components/admin/access-denied';
import { PageHero } from '@/components/layout/page-hero';
import { FilterBar, Pagination, SearchField } from '@/components/layout/list-controls';
import { PERMISSIONS } from '@/server/domain/rbac/permissions';
import { Badge } from '@/components/ui/badge';
import { Field, Select } from '@/components/ui/input';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  EmptyRow,
  TBody,
  TH,
  THead,
  TR,
  Table,
  TableBar,
  TableScroll,
  TableTitle,
  TableWrap,
} from '@/components/ui/table';
import {
  DISCIPLINES,
  ROLE_CODES,
  ROLE_LABELS,
  type Discipline,
  type RoleCode,
} from '@/server/domain/shared/enums';
import { UserRow } from './user-row';

// Reads live data on every request; an administrator must never act on a
// cached view of who is active.
export const dynamic = 'force-dynamic';

const STATUSES = [
  { value: 'active', label: 'Active only' },
  { value: 'inactive', label: 'Inactive only' },
  { value: 'locked', label: 'Locked out' },
  { value: 'mustChange', label: 'Must change password' },
] as const;

function formatDate(value: Date | null): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(value);
}

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: 'UTC' });

function dateParts(value: Date | null): { date: string; time: string } | null {
  return value ? { date: DAY.format(value), time: TIME.format(value) } : null;
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await requireActor();
  if (!actor.permissions.has(PERMISSIONS.USER_MANAGE)) {
    return <AccessDenied permission="user:manage" what="the user directory" />;
  }

  const params = await searchParams;

  // Unrecognised values are dropped rather than rejected, so a stale bookmark
  // shows the directory instead of an error.
  const filter: UserListFilter = {
    search: params.search || undefined,
    role: ROLE_CODES.includes(params.role as RoleCode) ? (params.role as RoleCode) : undefined,
    discipline: DISCIPLINES.includes(params.discipline as Discipline)
      ? (params.discipline as Discipline)
      : undefined,
    status: STATUSES.some((s) => s.value === params.status)
      ? (params.status as UserListFilter['status'])
      : undefined,
    page: Number(params.page) || 1,
  };

  const [result, roles] = await Promise.all([
    listUsers(actor, filter),
    listRolesForAssignment(actor),
  ]);

  const isFiltered = Boolean(filter.search || filter.role || filter.discipline || filter.status);

  const buildHref = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filter, page: String(page) })) {
      if (value !== undefined && value !== '') next.set(key, String(value));
    }
    const query = next.toString();
    return query ? `/admin/users?${query}` : '/admin/users';
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Administration"
        title="Users"
        subtitle="Accounts, roles and discipline. A user who has acted in the system is deactivated rather than deleted, so the audit trail always retains the identity behind an action."
        actions={
          <Badge variant="brand" size="lg">
            {result.stats.total.toLocaleString()} accounts
          </Badge>
        }
      />

      <StatGrid>
        <StatCard
          label="Active accounts"
          value={result.stats.active.toLocaleString()}
          caption="Can sign in today"
          icon={UserCheck}
          tone="good"
          href="/admin/users?status=active"
        />
        <StatCard
          label="Inactive"
          value={result.stats.inactive.toLocaleString()}
          caption="Deactivated, history retained"
          icon={UserX}
          href="/admin/users?status=inactive"
        />
        <StatCard
          label="Locked out"
          value={result.stats.locked.toLocaleString()}
          caption="Failed sign-in threshold"
          icon={Lock}
          tone={result.stats.locked > 0 ? 'danger' : 'default'}
          href="/admin/users?status=locked"
        />
        <StatCard
          label="Must change password"
          value={result.stats.mustChange.toLocaleString()}
          caption="Initial or expired credential"
          icon={KeyRound}
          tone={result.stats.mustChange > 0 ? 'warning' : 'default'}
          href="/admin/users?status=mustChange"
        />
      </StatGrid>

      <FilterBar clearHref={isFiltered ? '/admin/users' : undefined}>
        <SearchField
          label="Search directory"
          defaultValue={filter.search ?? ''}
          placeholder="Name, employee ID or email"
        />

        <Field label="Role" htmlFor="role" className="w-full sm:w-52">
          <Select id="role" name="role" defaultValue={filter.role ?? ''}>
            <option value="">All roles</option>
            {ROLE_CODES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LABELS[code] ?? code}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Discipline" htmlFor="discipline" className="w-full sm:w-44">
          <Select id="discipline" name="discipline" defaultValue={filter.discipline ?? ''}>
            <option value="">All disciplines</option>
            {DISCIPLINES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status" htmlFor="status" className="w-full sm:w-52">
          <Select id="status" name="status" defaultValue={filter.status ?? ''}>
            <option value="">Any status</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </FilterBar>

      <Alert variant="info">
        <Info aria-hidden="true" />
        <AlertDescription>
          Changing a user&apos;s roles takes effect on their next request — permissions are resolved
          per request, not cached for the life of a session. Deactivating an account ends its live
          sessions immediately.
        </AlertDescription>
      </Alert>

      <TableWrap>
        <TableBar>
          <TableTitle>
            <Users className="h-4 w-4 text-nib-gold-600" aria-hidden="true" />
            User directory
          </TableTitle>
          <Badge variant="default">
            {result.total.toLocaleString()} {isFiltered ? 'matching' : 'accounts'} · page{' '}
            {result.page} of {result.pageCount}
          </Badge>
        </TableBar>
        <TableScroll>
          {/* Eight columns: slightly tighter cell padding than the default keeps
              the register inside the card on a laptop-width screen. */}
          <Table className="[&_td]:px-3 [&_th]:px-3">
            <THead>
              <TR>
                <TH>Employee</TH>
                <TH>Unit / department</TH>
                <TH>Roles</TH>
                <TH>Discipline</TH>
                <TH className="text-center" title="Cases as maker / as checker">
                  Cases
                </TH>
                <TH>Last sign-in</TH>
                <TH>Status</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.rows.length === 0 ? (
                <EmptyRow
                  colSpan={8}
                  icon={Users}
                  title={isFiltered ? 'No matching accounts' : 'No accounts yet'}
                >
                  {isFiltered
                    ? 'No users match these filters. Try clearing the role or status.'
                    : 'No user accounts exist yet.'}
                </EmptyRow>
              ) : (
                result.rows.map((user) => (
                  <UserRow
                    key={user.id}
                    user={{
                      id: user.id,
                      employeeId: user.employeeId,
                      fullName: user.fullName,
                      email: user.email,
                      discipline: user.discipline,
                      isActive: user.isActive,
                      isLocked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
                      mustChange: user.credential?.mustChange ?? false,
                      organization: user.organization?.name ?? null,
                      department: user.department?.name ?? null,
                      roles: user.roles.map((r) => r.role.code as RoleCode),
                      makerCases: user._count.makerCases,
                      checkerCases: user._count.checkerCases,
                      lastLogin: formatDate(user.lastLoginAt),
                      lastLoginParts: dateParts(user.lastLoginAt),
                    }}
                    allRoles={roles.map((r) => ({
                      code: r.code as RoleCode,
                      label: ROLE_LABELS[r.code as RoleCode] ?? r.name,
                    }))}
                    isSelf={user.id === actor.id}
                  />
                ))
              )}
            </TBody>
          </Table>
        </TableScroll>
      </TableWrap>

      <Pagination
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        noun="accounts"
        buildHref={buildHref}
      />
    </div>
  );
}
