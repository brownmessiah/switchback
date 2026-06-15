import { describe, expect, it } from 'vitest'

import { VENDOR_NAV_ITEMS } from './vendor-nav'

describe('vendor-nav', () => {
  it('contains exactly 9 nav items', () => {
    expect(VENDOR_NAV_ITEMS).toHaveLength(9)
  })

  it('includes all expected labels in order', () => {
    const labels = VENDOR_NAV_ITEMS.map((item) => item.label)
    expect(labels).toEqual([
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

  it('keeps Dashboard first and places Analytics directly after it', () => {
    const firstTwo = VENDOR_NAV_ITEMS.slice(0, 2).map((item) => item.label)
    expect(firstTwo).toEqual(['Dashboard', 'Analytics'])
  })

  it('preserves the original core items (Listings, Bookings, Payouts) after Analytics', () => {
    const coreItems = VENDOR_NAV_ITEMS.slice(2, 5).map((item) => item.label)
    expect(coreItems).toEqual(['Listings', 'Bookings', 'Payouts'])
  })

  it('keeps the secondary items (Reviews, Messages, Team & Roles, Settings) last', () => {
    const tail = VENDOR_NAV_ITEMS.slice(5).map((item) => item.label)
    expect(tail).toEqual(['Reviews', 'Messages', 'Team & Roles', 'Settings'])
  })

  it('places Team & Roles directly above Settings (under Settings, adjacent)', () => {
    const labels = VENDOR_NAV_ITEMS.map((item) => item.label)
    const teamIdx = labels.indexOf('Team & Roles')
    const settingsIdx = labels.indexOf('Settings')
    expect(teamIdx).toBeGreaterThanOrEqual(0)
    expect(settingsIdx).toBe(teamIdx + 1)
  })
})
