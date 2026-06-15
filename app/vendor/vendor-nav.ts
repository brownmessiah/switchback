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
}

export const VENDOR_NAV_ITEMS: readonly VendorNavItem[] = [
  { href: '/vendor/dashboard', label: 'Dashboard', labelKey: 'dashboard', icon: '⊞' },
  { href: '/vendor/analytics', label: 'Analytics', labelKey: 'analytics', icon: '📈' },
  { href: '/vendor/listings', label: 'Listings', labelKey: 'listings', icon: '☰' },
  { href: '/vendor/bookings', label: 'Bookings', labelKey: 'bookings', icon: '📋' },
  { href: '/vendor/payouts', label: 'Payouts', labelKey: 'payouts', icon: '₹' },
  { href: '/vendor/reviews', label: 'Reviews', labelKey: 'reviews', icon: '★' },
  { href: '/vendor/messages', label: 'Messages', labelKey: 'messages', icon: '✉' },
  // Team & Roles sits under Settings (adjacent, just above it) — the Owner's
  // team-management surface (issue #05). Glyph mirrors the simple-icon style.
  { href: '/vendor/team', label: 'Team & Roles', labelKey: 'team', icon: '👥' },
  { href: '/vendor/settings', label: 'Settings', labelKey: 'settings', icon: '⚙' },
]
