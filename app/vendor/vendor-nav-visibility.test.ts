import { describe, expect, it } from 'vitest'

import { visibleVendorNavItems } from './vendor-nav'

/**
 * Role-aware sidebar nav-gating (issue #11 §6) — defense-in-depth UX only, NOT
 * the security boundary (every route still enforces its own gate). Visibility
 * is computed from the pure `can(role, perm)` matrix, never hardcoded role
 * lists, so the nav can never drift from the authorization matrix.
 */
describe('visibleVendorNavItems (issue #11 nav-gating)', () => {
  it('owner sees every nav item', () => {
    const hrefs = visibleVendorNavItems('owner').map((i) => i.href)
    expect(hrefs).toContain('/vendor/dashboard')
    expect(hrefs).toContain('/vendor/analytics')
    expect(hrefs).toContain('/vendor/listings')
    expect(hrefs).toContain('/vendor/bookings')
    expect(hrefs).toContain('/vendor/payouts')
    expect(hrefs).toContain('/vendor/team')
    expect(hrefs).toContain('/vendor/settings')
  })

  it('guide: no analytics, no payouts, no listings, no team — keeps bookings', () => {
    const hrefs = visibleVendorNavItems('guide').map((i) => i.href)
    expect(hrefs).toContain('/vendor/bookings')
    expect(hrefs).toContain('/vendor/dashboard')
    expect(hrefs).not.toContain('/vendor/analytics')
    expect(hrefs).not.toContain('/vendor/payouts')
    expect(hrefs).not.toContain('/vendor/listings')
    expect(hrefs).not.toContain('/vendor/team')
  })

  it('accountant: analytics + payouts visible, listings + team hidden', () => {
    const hrefs = visibleVendorNavItems('accountant').map((i) => i.href)
    expect(hrefs).toContain('/vendor/analytics')
    expect(hrefs).toContain('/vendor/payouts')
    expect(hrefs).toContain('/vendor/bookings')
    expect(hrefs).not.toContain('/vendor/listings')
    expect(hrefs).not.toContain('/vendor/team')
  })

  it('booking_staff: bookings only money-wise — no analytics/payouts/listings/team', () => {
    const hrefs = visibleVendorNavItems('booking_staff').map((i) => i.href)
    expect(hrefs).toContain('/vendor/bookings')
    expect(hrefs).not.toContain('/vendor/analytics')
    expect(hrefs).not.toContain('/vendor/payouts')
    expect(hrefs).not.toContain('/vendor/listings')
    expect(hrefs).not.toContain('/vendor/team')
  })

  it('manager: listings + analytics visible, payouts + team hidden', () => {
    const hrefs = visibleVendorNavItems('manager').map((i) => i.href)
    expect(hrefs).toContain('/vendor/listings')
    expect(hrefs).toContain('/vendor/analytics')
    expect(hrefs).toContain('/vendor/bookings')
    expect(hrefs).not.toContain('/vendor/payouts')
    expect(hrefs).not.toContain('/vendor/team')
  })

  it('team is owner-only across every non-owner role', () => {
    for (const role of ['manager', 'booking_staff', 'guide', 'accountant'] as const) {
      expect(visibleVendorNavItems(role).map((i) => i.href)).not.toContain('/vendor/team')
    }
    expect(visibleVendorNavItems('owner').map((i) => i.href)).toContain('/vendor/team')
  })

  it('preserves the source ordering of the items it keeps', () => {
    const owner = visibleVendorNavItems('owner').map((i) => i.label)
    expect(owner).toEqual([
      'Dashboard',
      'Analytics',
      'Listings',
      'Bookings',
      'Payouts',
      'Reviews',
      'Messages',
      'Team & Roles',
      'Settings',
    ])
  })
})
