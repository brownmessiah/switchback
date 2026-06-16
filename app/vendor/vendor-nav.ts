import { can, type VendorPermission, type VendorRole } from '@/lib/auth/vendor-permissions'

/**
 * Vendor sidebar navigation items.
 * Source of truth — tested in vendor-nav.test.ts.
 */
export interface VendorNavItem {
  readonly href: string
  readonly label: string
  /** Translation key in VendorNav.items namespace (e.g. 'dashboard', 'listings'). */
  readonly labelKey: string
  readonly icon: string
  /**
   * The permission that gates this item's VISIBILITY in the sidebar (issue #11
   * §6). `undefined` = always visible (held by every Vendor role — Dashboard,
   * Bookings, Reviews, Messages, Settings, which itself gates its sub-sections).
   * This is defense-in-depth UX only; every route enforces its own gate.
   */
  readonly permission?: VendorPermission
}

export const VENDOR_NAV_ITEMS: readonly VendorNavItem[] = [
  { href: '/vendor/dashboard', label: 'Dashboard', labelKey: 'dashboard', icon: '⊞' },
  {
    href: '/vendor/analytics',
    label: 'Analytics',
    labelKey: 'analytics',
    icon: '📈',
    permission: 'analytics:read',
  },
  {
    href: '/vendor/listings',
    label: 'Listings',
    labelKey: 'listings',
    icon: '☰',
    permission: 'experiences:manage',
  },
  { href: '/vendor/bookings', label: 'Bookings', labelKey: 'bookings', icon: '📋' },
  {
    href: '/vendor/payouts',
    label: 'Payouts',
    labelKey: 'payouts',
    icon: '₹',
    permission: 'payouts:read',
  },
  { href: '/vendor/reviews', label: 'Reviews', labelKey: 'reviews', icon: '★' },
  { href: '/vendor/messages', label: 'Messages', labelKey: 'messages', icon: '✉' },
  // Team & Roles sits under Settings (adjacent, just above it) — the Owner's
  // team-management surface (issue #05). Glyph mirrors the simple-icon style.
  // Owner-only via `team:manage` (the Owner wildcard; no member role holds it).
  {
    href: '/vendor/team',
    label: 'Team & Roles',
    labelKey: 'team',
    icon: '👥',
    permission: 'team:manage',
  },
  { href: '/vendor/settings', label: 'Settings', labelKey: 'settings', icon: '⚙' },
]

/**
 * The nav items VISIBLE to a given Vendor role (issue #11 §6), computed from the
 * pure `can(role, permission)` matrix — never a hardcoded role list, so the
 * sidebar can never drift from the authorization matrix. An item with no
 * `permission` is always shown (held by every role). Source ordering is
 * preserved. This hides links a role cannot use; it is NOT the security
 * boundary — each route re-enforces its own gate server-side.
 */
export function visibleVendorNavItems(role: VendorRole): readonly VendorNavItem[] {
  return VENDOR_NAV_ITEMS.filter(
    (item) => item.permission === undefined || can(role, item.permission),
  )
}
