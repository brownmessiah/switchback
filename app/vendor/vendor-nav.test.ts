import { describe, expect, it } from 'vitest'

import { VENDOR_NAV_ITEMS } from './vendor-nav'

describe('vendor-nav', () => {
  it('contains exactly 7 nav items', () => {
    expect(VENDOR_NAV_ITEMS).toHaveLength(7)
  })

  it('includes all expected labels in order', () => {
    const labels = VENDOR_NAV_ITEMS.map((item) => item.label)
    expect(labels).toEqual([
      'Dashboard',
      'Listings',
      'Bookings',
      'Payouts',
      'Reviews',
      'Messages',
      'Settings',
    ])
  })

  it('all hrefs are unique', () => {
    const hrefs = VENDOR_NAV_ITEMS.map((item) => item.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('every href starts with /vendor/', () => {
    for (const item of VENDOR_NAV_ITEMS) {
      expect(item.href.startsWith('/vendor/')).toBe(true)
    }
  })

  it('every item has a non-empty href, label, and icon', () => {
    for (const item of VENDOR_NAV_ITEMS) {
      expect(item.href).toBeTruthy()
      expect(item.label).toBeTruthy()
      expect(item.icon).toBeTruthy()
    }
  })

  it('preserves original 4 items (Dashboard, Listings, Bookings, Payouts) first', () => {
    const firstFour = VENDOR_NAV_ITEMS.slice(0, 4).map((item) => item.label)
    expect(firstFour).toEqual(['Dashboard', 'Listings', 'Bookings', 'Payouts'])
  })

  it('new items (Reviews, Messages, Settings) come after original items', () => {
    const lastThree = VENDOR_NAV_ITEMS.slice(4).map((item) => item.label)
    expect(lastThree).toEqual(['Reviews', 'Messages', 'Settings'])
  })
})
