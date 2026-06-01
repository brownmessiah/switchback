import type { AdminPermission } from '@/lib/auth/permissions'

/**
 * Sidebar navigation group definition for the admin panel.
 * Each group has a label and a list of navigation items.
 * Items are filtered by the admin's permissions before rendering.
 */
export interface AdminNavItem {
  readonly href: string
  readonly label: string
  /** Translation key in AdminNav.items namespace (e.g. 'overview', 'vendors'). */
  readonly labelKey: string
  readonly permission: AdminPermission
  /** Optional badge key — layout passes badge counts by key */
  readonly badgeKey?: string
}

export interface AdminNavGroup {
  readonly label: string
  /** Translation key in AdminNav.groups namespace (e.g. 'dashboard', 'marketplace'). */
  readonly labelKey: string
  readonly items: readonly AdminNavItem[]
}

/**
 * All 20 admin navigation items organized into 5 groups.
 * Source of truth for the admin sidebar — the route-to-permission
 * mapping is defined here and tested in admin-nav.test.ts.
 */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: 'Dashboard',
    labelKey: 'dashboard',
    items: [
      { href: '/admin/dashboard', label: 'Overview', labelKey: 'overview', permission: 'overview' },
      { href: '/admin/analytics', label: 'Analytics', labelKey: 'analytics', permission: 'analytics' },
    ],
  },
  {
    label: 'Marketplace',
    labelKey: 'marketplace',
    items: [
      { href: '/admin/vendors', label: 'Vendors', labelKey: 'vendors', permission: 'vendors', badgeKey: 'pendingKyc' },
      { href: '/admin/experiences', label: 'Experiences', labelKey: 'experiences', permission: 'experiences', badgeKey: 'pendingExperiences' },
      { href: '/admin/bookings', label: 'Bookings', labelKey: 'bookings', permission: 'bookings' },
      { href: '/admin/reviews', label: 'Reviews', labelKey: 'reviews', permission: 'reviews' },
    ],
  },
  {
    label: 'Finance',
    labelKey: 'finance',
    items: [
      { href: '/admin/commission', label: 'Commission', labelKey: 'commission', permission: 'commission' },
      { href: '/admin/payouts', label: 'Payouts', labelKey: 'payouts', permission: 'payouts' },
      { href: '/admin/refunds', label: 'Refunds', labelKey: 'refunds', permission: 'refunds' },
      { href: '/admin/disputes', label: 'Disputes', labelKey: 'disputes', permission: 'bookings', badgeKey: 'disputedBookings' },
      { href: '/admin/promo', label: 'Promo Codes', labelKey: 'promoCodes', permission: 'commission' },
      { href: '/admin/loyalty', label: 'Loyalty', labelKey: 'loyalty', permission: 'commission' },
    ],
  },
  {
    label: 'Content',
    labelKey: 'content',
    items: [
      { href: '/admin/blog', label: 'Blog', labelKey: 'blog', permission: 'blog' },
      { href: '/admin/site-builder', label: 'Site Builder', labelKey: 'siteBuilder', permission: 'site_builder' },
    ],
  },
  {
    label: 'Operations',
    labelKey: 'operations',
    items: [
      { href: '/admin/support', label: 'Support', labelKey: 'support', permission: 'support' },
      { href: '/admin/region-closures', label: 'Region Closures', labelKey: 'regionClosures', permission: 'region_closures' },
      { href: '/admin/users', label: 'Users', labelKey: 'users', permission: 'users' },
      { href: '/admin/audit', label: 'Audit Logs', labelKey: 'auditLogs', permission: 'audit' },
      { href: '/admin/sub-admins', label: 'Sub-Admins', labelKey: 'subAdmins', permission: 'sub_admins' },
      { href: '/admin/reports', label: 'Reports', labelKey: 'reports', permission: 'reports' },
    ],
  },
]

/** Flat list of all nav items across all groups. */
export function getAllNavItems(): readonly AdminNavItem[] {
  return ADMIN_NAV_GROUPS.flatMap((group) => group.items)
}

/**
 * Filter navigation groups by the admin's permission set.
 * Groups with zero visible items are excluded entirely.
 */
export function filterNavByPermissions(
  permissions: readonly string[],
): readonly AdminNavGroup[] {
  const permSet = new Set(permissions)
  const isFullAdmin = permSet.has('*')
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isFullAdmin || permSet.has(item.permission)),
  })).filter((group) => group.items.length > 0)
}
