/**
 * Tests for authenticated-route i18n message coverage.
 *
 * Verifies that AdminNav, VendorNav, CustomerNav, and Common.actions
 * namespaces exist in both en.json and hi.json with matching key shapes.
 */

import { describe, expect, it } from 'vitest'

import enMessages from './messages/en.json'
import hiMessages from './messages/hi.json'

/** Recursively collect all leaf-level keys as dot-separated paths. */
function collectKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...collectKeys(value as Record<string, unknown>, path))
    } else {
      keys.push(path)
    }
  }
  return keys.sort()
}

describe('authenticated-route i18n messages', () => {
  describe('AdminNav namespace', () => {
    it('exists in en.json', () => {
      expect(enMessages).toHaveProperty('AdminNav')
    })

    it('exists in hi.json', () => {
      expect(hiMessages).toHaveProperty('AdminNav')
    })

    it('has matching keys in en.json and hi.json', () => {
      const enKeys = collectKeys(
        (enMessages as Record<string, Record<string, unknown>>).AdminNav,
      )
      const hiKeys = collectKeys(
        (hiMessages as Record<string, Record<string, unknown>>).AdminNav,
      )
      expect(enKeys).toEqual(hiKeys)
    })

    it('includes all admin group labels', () => {
      const adminNav = (enMessages as Record<string, Record<string, unknown>>).AdminNav as Record<string, unknown>
      const groups = adminNav.groups as Record<string, unknown>
      expect(groups).toHaveProperty('dashboard')
      expect(groups).toHaveProperty('marketplace')
      expect(groups).toHaveProperty('finance')
      expect(groups).toHaveProperty('content')
      expect(groups).toHaveProperty('operations')
    })

    it('includes all 20 admin nav item labels', () => {
      const adminNav = (enMessages as Record<string, Record<string, unknown>>).AdminNav as Record<string, unknown>
      const items = adminNav.items as Record<string, unknown>
      // 20 items across all groups (#17 added the general /admin/users screen)
      expect(Object.keys(items)).toHaveLength(20)
    })

    it('includes sidebar title', () => {
      const adminNav = (enMessages as Record<string, Record<string, unknown>>).AdminNav as Record<string, unknown>
      expect(adminNav).toHaveProperty('sidebarTitle')
    })
  })

  describe('VendorNav namespace', () => {
    it('exists in en.json', () => {
      expect(enMessages).toHaveProperty('VendorNav')
    })

    it('exists in hi.json', () => {
      expect(hiMessages).toHaveProperty('VendorNav')
    })

    it('has matching keys in en.json and hi.json', () => {
      const enKeys = collectKeys(
        (enMessages as Record<string, Record<string, unknown>>).VendorNav,
      )
      const hiKeys = collectKeys(
        (hiMessages as Record<string, Record<string, unknown>>).VendorNav,
      )
      expect(enKeys).toEqual(hiKeys)
    })

    it('includes all 7 vendor nav item labels', () => {
      const vendorNav = (enMessages as Record<string, Record<string, unknown>>).VendorNav as Record<string, unknown>
      const items = vendorNav.items as Record<string, unknown>
      expect(Object.keys(items)).toHaveLength(7)
    })

    it('includes portal title and complete setup CTA', () => {
      const vendorNav = (enMessages as Record<string, Record<string, unknown>>).VendorNav as Record<string, unknown>
      expect(vendorNav).toHaveProperty('portalTitle')
      expect(vendorNav).toHaveProperty('completeSetup')
    })
  })

  describe('CustomerNav namespace', () => {
    it('exists in en.json', () => {
      expect(enMessages).toHaveProperty('CustomerNav')
    })

    it('exists in hi.json', () => {
      expect(hiMessages).toHaveProperty('CustomerNav')
    })

    it('has matching keys in en.json and hi.json', () => {
      const enKeys = collectKeys(
        (enMessages as Record<string, Record<string, unknown>>).CustomerNav,
      )
      const hiKeys = collectKeys(
        (hiMessages as Record<string, Record<string, unknown>>).CustomerNav,
      )
      expect(enKeys).toEqual(hiKeys)
    })

    it('includes page title and wallet labels', () => {
      const customerNav = (enMessages as Record<string, Record<string, unknown>>).CustomerNav as Record<string, unknown>
      expect(customerNav).toHaveProperty('pageTitle')
      expect(customerNav).toHaveProperty('wallet')
    })
  })

  describe('Common.actions namespace', () => {
    it('exists in en.json', () => {
      const common = (enMessages as Record<string, Record<string, unknown>>).Common
      expect(common).toHaveProperty('actions')
    })

    it('exists in hi.json', () => {
      const common = (hiMessages as Record<string, Record<string, unknown>>).Common
      expect(common).toHaveProperty('actions')
    })

    it('includes standard action buttons', () => {
      const actions = (
        (enMessages as Record<string, Record<string, unknown>>).Common as Record<string, Record<string, unknown>>
      ).actions
      expect(actions).toHaveProperty('save')
      expect(actions).toHaveProperty('cancel')
      expect(actions).toHaveProperty('delete')
      expect(actions).toHaveProperty('back')
      expect(actions).toHaveProperty('edit')
      expect(actions).toHaveProperty('submit')
    })

    it('includes status labels', () => {
      const common = (enMessages as Record<string, Record<string, unknown>>).Common as Record<string, Record<string, unknown>>
      expect(common).toHaveProperty('status')
    })

    it('has matching action keys in en.json and hi.json', () => {
      const enActions = (
        (enMessages as Record<string, Record<string, unknown>>).Common as Record<string, Record<string, unknown>>
      ).actions
      const hiActions = (
        (hiMessages as Record<string, Record<string, unknown>>).Common as Record<string, Record<string, unknown>>
      ).actions
      const enKeys = collectKeys(enActions as Record<string, unknown>)
      const hiKeys = collectKeys(hiActions as Record<string, unknown>)
      expect(enKeys).toEqual(hiKeys)
    })
  })
})
