/**
 * Tests for authenticated-route i18n message coverage.
 *
 * Verifies that AdminNav, VendorNav, CustomerNav, and Common.actions
 * namespaces exist in both en.json and hi.json with matching key shapes.
 */

import { describe, expect, it } from 'vitest'

import { VENDOR_NAV_ITEMS } from '@/app/vendor/vendor-nav'
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n/config'

import asMessages from './messages/as.json'
import bnMessages from './messages/bn.json'
import enMessages from './messages/en.json'
import guMessages from './messages/gu.json'
import hiMessages from './messages/hi.json'
import knMessages from './messages/kn.json'
import mlMessages from './messages/ml.json'
import mrMessages from './messages/mr.json'
import orMessages from './messages/or.json'
import paMessages from './messages/pa.json'
import taMessages from './messages/ta.json'
import teMessages from './messages/te.json'
import urMessages from './messages/ur.json'

/** All locale message bundles keyed by locale code, for cross-locale coverage. */
const MESSAGES_BY_LOCALE: Record<SupportedLocale, Record<string, unknown>> = {
  en: enMessages,
  hi: hiMessages,
  ta: taMessages,
  te: teMessages,
  kn: knMessages,
  bn: bnMessages,
  mr: mrMessages,
  ml: mlMessages,
  gu: guMessages,
  pa: paMessages,
  or: orMessages,
  as: asMessages,
  ur: urMessages,
}

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

    it('includes all 8 vendor nav item labels', () => {
      const vendorNav = (enMessages as Record<string, Record<string, unknown>>).VendorNav as Record<string, unknown>
      const items = vendorNav.items as Record<string, unknown>
      // 8 items (#01 added the /vendor/analytics surface)
      expect(Object.keys(items)).toHaveLength(8)
    })

    it('includes portal title and complete setup CTA', () => {
      const vendorNav = (enMessages as Record<string, Record<string, unknown>>).VendorNav as Record<string, unknown>
      expect(vendorNav).toHaveProperty('portalTitle')
      expect(vendorNav).toHaveProperty('completeSetup')
    })
  })

  describe('VendorAnalytics namespace', () => {
    it('exists in en.json', () => {
      expect(enMessages).toHaveProperty('VendorAnalytics')
    })

    it('exists in hi.json', () => {
      expect(hiMessages).toHaveProperty('VendorAnalytics')
    })

    it('has matching keys in en.json and hi.json', () => {
      const enKeys = collectKeys(
        (enMessages as Record<string, Record<string, unknown>>).VendorAnalytics,
      )
      const hiKeys = collectKeys(
        (hiMessages as Record<string, Record<string, unknown>>).VendorAnalytics,
      )
      expect(enKeys).toEqual(hiKeys)
    })

    it('includes the page title, KPI labels, and empty-state message', () => {
      const va = (enMessages as Record<string, Record<string, unknown>>).VendorAnalytics as Record<string, unknown>
      expect(va).toHaveProperty('title')
      expect(va).toHaveProperty('totalRevenue')
      expect(va).toHaveProperty('totalBookings')
      expect(va).toHaveProperty('emptyState')
    })
  })

  describe('VendorQuickActions namespace', () => {
    it('exists in en.json', () => {
      expect(enMessages).toHaveProperty('VendorQuickActions')
    })

    it('exists in hi.json', () => {
      expect(hiMessages).toHaveProperty('VendorQuickActions')
    })

    it('has matching keys in en.json and hi.json', () => {
      const enKeys = collectKeys(
        (enMessages as Record<string, Record<string, unknown>>).VendorQuickActions,
      )
      const hiKeys = collectKeys(
        (hiMessages as Record<string, Record<string, unknown>>).VendorQuickActions,
      )
      expect(enKeys).toEqual(hiKeys)
    })

    it('includes the heading and the four card labels', () => {
      const qa = (enMessages as Record<string, Record<string, unknown>>).VendorQuickActions as Record<string, unknown>
      expect(qa).toHaveProperty('heading')
      expect(qa).toHaveProperty('addExperience')
      expect(qa).toHaveProperty('viewBookings')
      expect(qa).toHaveProperty('manageAvailability')
      expect(qa).toHaveProperty('viewEarnings')
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

  // Regression guard for the cross-locale i18n gap (#01 analytics surface).
  // request.ts loads a SINGLE locale file with no runtime merge against en,
  // so any key missing from a non-en locale throws MISSING_MESSAGE for users
  // browsing in that locale. Every supported locale must physically contain
  // the keys consumed by the vendor sidebar and the analytics page.
  describe('cross-locale coverage for the vendor analytics surface', () => {
    const enVendorAnalyticsKeys = collectKeys(
      (enMessages as Record<string, Record<string, unknown>>).VendorAnalytics,
    )
    // #04 dashboard quick-action cards — same single-locale-load hazard: every
    // supported locale must physically carry the VendorQuickActions keys or a
    // vendor browsing in that locale gets a MISSING_MESSAGE crash on the home.
    const enVendorQuickActionsKeys = collectKeys(
      (enMessages as Record<string, Record<string, unknown>>).VendorQuickActions,
    )

    for (const locale of SUPPORTED_LOCALES) {
      describe(`locale: ${locale}`, () => {
        it('resolves every VENDOR_NAV_ITEMS labelKey under VendorNav.items', () => {
          const messages = MESSAGES_BY_LOCALE[locale]
          const vendorNav = messages.VendorNav as Record<string, unknown> | undefined
          const items = vendorNav?.items as Record<string, unknown> | undefined
          expect(items, `${locale}.json is missing VendorNav.items`).toBeDefined()

          for (const navItem of VENDOR_NAV_ITEMS) {
            expect(
              items,
              `${locale}.json VendorNav.items is missing "${navItem.labelKey}"`,
            ).toHaveProperty(navItem.labelKey)
          }
        })

        it('has a VendorAnalytics namespace with the same key set as en', () => {
          const messages = MESSAGES_BY_LOCALE[locale]
          const vendorAnalytics = messages.VendorAnalytics as
            | Record<string, unknown>
            | undefined
          expect(
            vendorAnalytics,
            `${locale}.json is missing the VendorAnalytics namespace`,
          ).toBeDefined()

          const localeKeys = collectKeys(vendorAnalytics as Record<string, unknown>)
          expect(
            localeKeys,
            `${locale}.json VendorAnalytics keys differ from en`,
          ).toEqual(enVendorAnalyticsKeys)
        })

        it('has a VendorQuickActions namespace with the same key set as en', () => {
          const messages = MESSAGES_BY_LOCALE[locale]
          const vendorQuickActions = messages.VendorQuickActions as
            | Record<string, unknown>
            | undefined
          expect(
            vendorQuickActions,
            `${locale}.json is missing the VendorQuickActions namespace`,
          ).toBeDefined()

          const localeKeys = collectKeys(vendorQuickActions as Record<string, unknown>)
          expect(
            localeKeys,
            `${locale}.json VendorQuickActions keys differ from en`,
          ).toEqual(enVendorQuickActionsKeys)
        })
      })
    }
  })
})
