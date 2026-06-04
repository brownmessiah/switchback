import { describe, expect, it } from 'vitest'

import { isBackOfficePath } from './back-office-path'

/**
 * The consumer marketing SiteHeader + SiteFooter live in the root layout and
 * therefore render inside the /admin and /vendor back-office too (critique E).
 * They must return null on back-office paths.
 *
 * The collision that makes this non-trivial: the PUBLIC vendor storefront is
 * `/vendor/<slug>` (un-prefixed `en`), which must KEEP the consumer chrome —
 * only the vendor DASHBOARD prefixes (/vendor/dashboard, /vendor/listings, …)
 * are back-office. Pure over its single string input.
 */
describe('isBackOfficePath (E — hide consumer chrome in admin + vendor back-office)', () => {
  it('is true for the admin root and admin subpaths', () => {
    expect(isBackOfficePath('/admin')).toBe(true)
    expect(isBackOfficePath('/admin/bookings')).toBe(true)
    expect(isBackOfficePath('/admin/vendors/123')).toBe(true)
  })

  it('is true for every vendor dashboard prefix', () => {
    for (const p of [
      '/vendor/dashboard',
      '/vendor/listings',
      '/vendor/listings/abc/edit',
      '/vendor/bookings',
      '/vendor/messages',
      '/vendor/onboarding',
      '/vendor/payouts',
      '/vendor/reviews',
      '/vendor/settings',
    ]) {
      expect(isBackOfficePath(p), `${p} is back-office`).toBe(true)
    }
  })

  it('is FALSE for the public vendor storefront at /vendor/<slug>', () => {
    // The collision: a public storefront slug must KEEP the consumer chrome.
    expect(isBackOfficePath('/vendor/goa-dive-center')).toBe(false)
    expect(isBackOfficePath('/vendor/himalayan-hikes-co')).toBe(false)
  })

  it('is FALSE for consumer account surfaces (they keep the consumer footer)', () => {
    for (const p of ['/dashboard', '/wallet', '/support', '/wishlist', '/community']) {
      expect(isBackOfficePath(p), `${p} keeps chrome`).toBe(false)
    }
  })

  it('is FALSE for marketing routes (home, search, locale-prefixed)', () => {
    expect(isBackOfficePath('/')).toBe(false)
    expect(isBackOfficePath('/search')).toBe(false)
    expect(isBackOfficePath('/hi/experience/some-trek')).toBe(false)
    expect(isBackOfficePath('/cancellation-policy')).toBe(false)
  })

  it('does not match a path that merely starts with the prefix string but is a different segment', () => {
    // `/vendorish` must not be treated as `/vendor/...`.
    expect(isBackOfficePath('/admins-club')).toBe(false)
    expect(isBackOfficePath('/vendor-guide')).toBe(false)
  })
})
