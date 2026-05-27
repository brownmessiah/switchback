import type { AdminPermission } from '@/lib/auth/permissions'

/**
 * Sidebar navigation group definition for the admin panel.
 * Each group has a label and a list of navigation items.
 * Items are filtered by the admin's permissions before rendering.
 */
export interface AdminNavItem {
  readonly href: string
  readonly label: string
  readonly permission: AdminPermission
  /** Optional badge key — layout passes badge counts by key */
  readonly badgeKey?: string
}

export interface AdminNavGroup {
  readonly label: string
  readonly items: readonly AdminNavItem[]
}

/**
 * All 19 admin navigation items organized into 5 groups.
 * Source of truth for the admin sidebar — the route-to-permission
 * mapping is defined here and tested in admin-nav.test.ts.
 */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: 'Dashboard',
    items: [
      { href: '/admin/dashboard', label: 'Overview', permission: 'overview' },
      { href: '/admin/analytics', label: 'Analytics', permission: 'analytics' },
    ],
  },
  {
    label: 'Marketplace',
    items: [
      { href: '/admin/vendors', label: 'Vendors', permission: 'vendors', badgeKey: 'pendingKyc' },
      { href: '/admin/experiences', label: 'Experiences', permission: 'experiences', badgeKey: 'pendingExperiences' },
      { href: '/admin/bookings', label: 'Bookings', permission: 'bookings' },
      { href: '/admin/reviews', label: 'Reviews', permission: 'reviews' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { href: '/admin/commission', label: 'Commission', permission: 'commission' },
      { href: '/admin/payouts', label: 'Payouts', permission: 'payouts' },
      { href: '/admin/refunds', label: 'Refunds', permission: 'refunds' },
      { href: '/admin/disputes', label: 'Disputes', permission: 'bookings', badgeKey: 'disputedBookings' },
      { href: '/admin/promo', label: 'Promo Codes', permission: 'commission' },
      { href: '/admin/loyalty', label: 'Loyalty', permission: 'commission' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/blog', label: 'Blog', permission: 'blog' },
      { href: '/admin/site-builder', label: 'Site Builder', permission: 'site_builder' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/support', label: 'Support', permission: 'support' },
      { href: '/admin/region-closures', label: 'Region Closures', permission: 'region_closures' },
      { href: '/admin/audit', label: 'Audit Logs', permission: 'audit' },
      { href: '/admin/sub-admins', label: 'Sub-Admins', permission: 'sub_admins' },
      { href: '/admin/reports', label: 'Reports', permission: 'reports' },
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
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => permSet.has(item.permission)),
  })).filter((group) => group.items.length > 0)
}
