import { describe, expect, it } from 'vitest'

import { ADMIN_PERMISSIONS } from '@/lib/auth/permissions'

import {
  ADMIN_NAV_GROUPS,
  filterNavByPermissions,
  getAllNavItems,
} from './admin-nav'

describe('admin-nav', () => {
  describe('ADMIN_NAV_GROUPS', () => {
    it('contains exactly 5 groups', () => {
      expect(ADMIN_NAV_GROUPS).toHaveLength(5)
    })

    it('groups are named Dashboard, Marketplace, Finance, Content, Operations', () => {
      const labels = ADMIN_NAV_GROUPS.map((g) => g.label)
      expect(labels).toEqual([
        'Dashboard',
        'Marketplace',
        'Finance',
        'Content',
        'Operations',
      ])
    })

    it('has exactly 20 nav items across all groups', () => {
      const allItems = getAllNavItems()
      expect(allItems).toHaveLength(20)
    })

    it('every nav item has a non-empty href, label, and permission', () => {
      for (const item of getAllNavItems()) {
        expect(item.href).toBeTruthy()
        expect(item.label).toBeTruthy()
        expect(item.permission).toBeTruthy()
      }
    })

    it('every permission references a valid ADMIN_PERMISSIONS entry', () => {
      const validPerms = new Set<string>(ADMIN_PERMISSIONS)
      for (const item of getAllNavItems()) {
        expect(validPerms.has(item.permission)).toBe(true)
      }
    })

    it('every href starts with /admin/', () => {
      for (const item of getAllNavItems()) {
        expect(item.href.startsWith('/admin/')).toBe(true)
      }
    })

    it('all hrefs are unique', () => {
      const hrefs = getAllNavItems().map((i) => i.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
    })
  })

  describe('filterNavByPermissions', () => {
    it('full admin (all 17 permissions) sees all 20 nav items', () => {
      const filtered = filterNavByPermissions([...ADMIN_PERMISSIONS])
      const totalItems = filtered.reduce((sum, g) => sum + g.items.length, 0)
      expect(totalItems).toBe(20)
      expect(filtered).toHaveLength(5) // all 5 groups visible
    })

    it('sub-admin with [vendors, bookings] sees exactly 3 items', () => {
      const filtered = filterNavByPermissions(['vendors', 'bookings'])
      const totalItems = filtered.reduce((sum, g) => sum + g.items.length, 0)
      expect(totalItems).toBe(3) // Vendors, Bookings, Disputes
    })

    it('sub-admin with [vendors, bookings] sees Marketplace and Finance groups', () => {
      const filtered = filterNavByPermissions(['vendors', 'bookings'])
      expect(filtered).toHaveLength(2)
      expect(filtered[0]!.label).toBe('Marketplace')
      expect(filtered[1]!.label).toBe('Finance')
    })

    it('empty permissions sees 0 items and 0 groups', () => {
      const filtered = filterNavByPermissions([])
      const totalItems = filtered.reduce((sum, g) => sum + g.items.length, 0)
      expect(totalItems).toBe(0)
      expect(filtered).toHaveLength(0)
    })

    it('commission permission grants Promo Codes and Loyalty in addition to Commission', () => {
      const filtered = filterNavByPermissions(['commission'])
      const totalItems = filtered.reduce((sum, g) => sum + g.items.length, 0)
      expect(totalItems).toBe(3) // Commission + Promo Codes + Loyalty
      expect(filtered).toHaveLength(1)
      expect(filtered[0].label).toBe('Finance')
    })

    it('does not mutate the original ADMIN_NAV_GROUPS', () => {
      const originalLength = ADMIN_NAV_GROUPS.length
      filterNavByPermissions(['vendors'])
      expect(ADMIN_NAV_GROUPS).toHaveLength(originalLength)
      // Verify items within groups are unchanged
      const allItems = getAllNavItems()
      expect(allItems).toHaveLength(20)
    })

    it('the /admin/users item is gated on the `users` permission', () => {
      const usersItem = getAllNavItems().find((i) => i.href === '/admin/users')
      expect(usersItem).toBeDefined()
      expect(usersItem!.permission).toBe('users')
    })

    it('the default sub-admin grant (vendors/audit/analytics) does NOT see /admin/users', () => {
      const filtered = filterNavByPermissions(['vendors', 'audit', 'analytics'])
      const hasUsers = filtered
        .flatMap((g) => g.items)
        .some((i) => i.href === '/admin/users')
      expect(hasUsers).toBe(false)
    })

    it('a sub-admin explicitly granted `users` sees /admin/users', () => {
      const filtered = filterNavByPermissions(['users'])
      const hasUsers = filtered
        .flatMap((g) => g.items)
        .some((i) => i.href === '/admin/users')
      expect(hasUsers).toBe(true)
    })

    it('badge keys are preserved on filtered items', () => {
      const filtered = filterNavByPermissions(['vendors', 'experiences'])
      const vendorItem = filtered
        .flatMap((g) => g.items)
        .find((i) => i.href === '/admin/vendors')
      expect(vendorItem?.badgeKey).toBe('pendingKyc')
      const expItem = filtered
        .flatMap((g) => g.items)
        .find((i) => i.href === '/admin/experiences')
      expect(expItem?.badgeKey).toBe('pendingExperiences')
    })
  })
})
