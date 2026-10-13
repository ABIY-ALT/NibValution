import { PERMISSIONS, type PermissionCode } from '@/server/domain/rbac/permissions';

/**
 * Navigation, grouped the way the NIB Board Governance Portal groups it —
 * MAIN, then subject areas, then WORK QUEUE, COMMUNICATIONS, MONITORING and
 * ADMINISTRATION — so a member of staff moving between the two systems meets
 * one institution rather than two products.
 *
 * Visibility is derived from permissions, not role names. Hiding a link is a
 * usability decision only; every destination re-checks authorisation
 * server-side (rule 4). Deriving it from the same permission codes the server
 * enforces means the menu cannot drift into advertising pages a user will be
 * refused.
 */

/** Live counters the rail can display as a badge, supplied at render time. */
export type BadgeKey = 'openTasks' | 'pendingApprovals' | 'returned' | 'overdue' | 'unread';

export interface NavItem {
  label: string;
  href: string;
  /** Shown when the actor holds any one of these permissions. */
  permissions: readonly PermissionCode[];
  icon: string;
  badgeKey?: BadgeKey;
  /**
   * Whether the destination exists yet.
   *
   * The menu must never advertise a page that 404s: a link that goes nowhere
   * reads as a broken system rather than an unfinished one. Items flip to
   * `true` as their phase lands (docs/07-implementation-roadmap.md).
   */
  built: boolean;
}

export interface NavSection {
  title: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Main',
    items: [
      {
        label: 'Dashboard',
        href: '/dashboard',
        icon: 'LayoutDashboard',
        permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CONFIG_READ],
        built: true,
      },
    ],
  },
  {
    title: 'Valuation',
    items: [
      {
        label: 'Valuation Requests',
        href: '/requests',
        icon: 'FileText',
        permissions: [PERMISSIONS.CASE_READ],
        built: true,
      },
      {
        label: 'New Request',
        href: '/requests/new',
        icon: 'FilePlus2',
        permissions: [PERMISSIONS.CASE_CREATE],
        built: true,
      },
      {
        label: 'Civil Properties',
        href: '/civil',
        icon: 'Building2',
        permissions: [PERMISSIONS.VALUATION_READ],
        built: true,
      },
      {
        label: 'Mechanical Properties',
        href: '/mechanical',
        icon: 'Cog',
        permissions: [PERMISSIONS.VALUATION_READ],
        built: true,
      },
      {
        label: 'Closed Archive',
        href: '/archive',
        icon: 'Archive',
        permissions: [PERMISSIONS.ARCHIVE_SEARCH],
        built: true,
      },
    ],
  },
  {
    title: 'Work Queue',
    items: [
      {
        label: 'My Tasks',
        href: '/tasks',
        icon: 'ListChecks',
        badgeKey: 'openTasks',
        permissions: [
          PERMISSIONS.VALUATION_START,
          PERMISSIONS.VALUATION_CHECK,
          PERMISSIONS.CASE_ASSIGN_MAKER,
          PERMISSIONS.CASE_ASSIGN_CHECKER,
        ],
        built: true,
      },
      {
        label: 'Pending Approvals',
        href: '/tasks/approvals',
        icon: 'Stamp',
        badgeKey: 'pendingApprovals',
        permissions: [PERMISSIONS.APPROVAL_MANAGER, PERMISSIONS.APPROVAL_DIRECTOR],
        built: true,
      },
      {
        label: 'Returned Cases',
        href: '/tasks/returned',
        icon: 'Undo2',
        badgeKey: 'returned',
        permissions: [PERMISSIONS.VALUATION_SUBMIT, PERMISSIONS.CASE_READ],
        built: true,
      },
      {
        label: 'Overdue Cases',
        href: '/tasks/overdue',
        icon: 'AlertTriangle',
        badgeKey: 'overdue',
        permissions: [PERMISSIONS.CASE_READ],
        built: true,
      },
    ],
  },
  {
    title: 'Communications',
    items: [
      {
        label: 'Notifications',
        href: '/notifications',
        icon: 'Bell',
        badgeKey: 'unread',
        permissions: [PERMISSIONS.CASE_READ, PERMISSIONS.CONFIG_READ],
        built: true,
      },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      {
        label: 'SLA Tracking',
        href: '/reports/sla',
        icon: 'Timer',
        permissions: [PERMISSIONS.REPORT_SLA],
        built: true,
      },
      {
        label: 'Reports',
        href: '/reports',
        icon: 'BarChart3',
        permissions: [PERMISSIONS.REPORT_OPERATIONAL, PERMISSIONS.REPORT_PERFORMANCE],
        built: true,
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Users',
        href: '/admin/users',
        icon: 'Users',
        permissions: [PERMISSIONS.USER_MANAGE],
        built: true,
      },
      {
        label: 'Roles & Permissions',
        href: '/admin/roles',
        icon: 'ShieldCheck',
        permissions: [PERMISSIONS.ROLE_MANAGE],
        built: true,
      },
      {
        label: 'Approval Thresholds',
        href: '/admin/thresholds',
        icon: 'GitBranch',
        permissions: [PERMISSIONS.THRESHOLD_UPDATE],
        built: true,
      },
      {
        label: 'Valuation Parameters',
        href: '/admin/parameters',
        icon: 'SlidersHorizontal',
        permissions: [PERMISSIONS.PARAMETER_UPDATE],
        built: true,
      },
      {
        label: 'Categories & Types',
        href: '/admin/categories',
        icon: 'Tags',
        permissions: [PERMISSIONS.CATEGORY_UPDATE],
        built: true,
      },
      {
        label: 'SLA & Calendar',
        href: '/admin/sla',
        icon: 'CalendarDays',
        permissions: [PERMISSIONS.SLA_CONFIG],
        built: true,
      },
      {
        label: 'Audit Log',
        href: '/admin/audit',
        icon: 'ScrollText',
        permissions: [PERMISSIONS.AUDIT_READ],
        built: true,
      },
    ],
  },
];

/**
 * Filter the menu to what this actor may actually reach: they must hold a
 * qualifying permission *and* the destination must exist.
 */
export function visibleSections(permissions: ReadonlySet<PermissionCode>): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    title: section.title,
    items: section.items.filter(
      (item) => item.built && item.permissions.some((p) => permissions.has(p)),
    ),
  })).filter((section) => section.items.length > 0);
}

/** Destinations a role will gain once their phase lands — shown as inert text. */
export function upcomingItems(permissions: ReadonlySet<PermissionCode>): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items).filter(
    (item) => !item.built && item.permissions.some((p) => permissions.has(p)),
  );
}
