/**
 * Tests that admin nav labelKey fields map to valid AdminNav translation keys.
 */

import { describe, expect, it } from 'vitest'

import enMessages from '@/lib/i18n/messages/en.json'

import { ADMIN_NAV_GROUPS, getAllNavItems } from './admin-nav'

const adminNav = (enMessages as Record<string, Record<string, unknown>>).AdminNav as {
  groups: Record<string, string>
  items: Record<string, string>
}

describe('admin-nav i18n key coverage', () => {
  it('every group has a labelKey that maps to AdminNav.groups', () => {
    for (const group of ADMIN_NAV_GROUPS) {
      expect(adminNav.groups).toHaveProperty(group.labelKey)
    }
  })

  it('every item has a labelKey that maps to AdminNav.items', () => {
    for (const item of getAllNavItems()) {
      expect(adminNav.items).toHaveProperty(item.labelKey)
    }
  })

  it('AdminNav.items has no extra keys beyond what nav data defines', () => {
    const navKeys = new Set(getAllNavItems().map((i) => i.labelKey))
    const messageKeys = Object.keys(adminNav.items)
    for (const key of messageKeys) {
      expect(navKeys.has(key)).toBe(true)
    }
  })

  it('AdminNav.groups has no extra keys beyond what nav data defines', () => {
    const navKeys = new Set(ADMIN_NAV_GROUPS.map((g) => g.labelKey))
    const messageKeys = Object.keys(adminNav.groups)
    for (const key of messageKeys) {
      expect(navKeys.has(key)).toBe(true)
    }
  })
})
