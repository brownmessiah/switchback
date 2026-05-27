/**
 * Vendor sidebar navigation items.
 * Source of truth — tested in vendor-nav.test.ts.
 */
export interface VendorNavItem {
  readonly href: string
  readonly label: string
  readonly icon: string
}

export const VENDOR_NAV_ITEMS: readonly VendorNavItem[] = [
  { href: '/vendor/dashboard', label: 'Dashboard', icon: '◻' },
  { href: '/vendor/listings', label: 'Listings', icon: '☰' },
  { href: '/vendor/bookings', label: 'Bookings', icon: '📋' },
  { href: '/vendor/payouts', label: 'Payouts', icon: '₹' },
  { href: '/vendor/reviews', label: 'Reviews', icon: '★' },
  { href: '/vendor/messages', label: 'Messages', icon: '✉' },
  { href: '/vendor/settings', label: 'Settings', icon: '⚙' },
]
