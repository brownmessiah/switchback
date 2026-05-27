/**
 * Tests that vendor nav labelKey fields map to valid VendorNav translation keys.
 */

import { describe, expect, it } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'

import { VENDOR_NAV_ITEMS } from './vendor-nav'

const vendorNav = (enMessages as Record<string, Record<string, unknown>>).VendorNav as {
  items: Record<string, string>
}

describe('vendor-nav i18n key coverage', () => {
  it('every item has a labelKey that maps to VendorNav.items', () => {
    for (const item of VENDOR_NAV_ITEMS) {
      expect(vendorNav.items).toHaveProperty(item.labelKey)
    }
  })

  it('VendorNav.items has no extra keys beyond what nav data defines', () => {
    const navKeys = new Set(VENDOR_NAV_ITEMS.map((i) => i.labelKey))
    const messageKeys = Object.keys(vendorNav.items)
    for (const key of messageKeys) {
      expect(navKeys.has(key)).toBe(true)
    }
  })
})
