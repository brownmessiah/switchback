import { describe, expect, it } from 'vitest'

import { EXCLUDED_PREFIXES, shouldExcludeFromI18n } from './routing'

// ---------------------------------------------------------------------------
// shouldExcludeFromI18n — route matching
// ---------------------------------------------------------------------------

describe('shouldExcludeFromI18n()', () => {
  describe('excluded routes (should return true)', () => {
    it('excludes /admin', () => {
      expect(shouldExcludeFromI18n('/admin')).toBe(true)
    })

    it('excludes /admin/analytics', () => {
      expect(shouldExcludeFromI18n('/admin/analytics')).toBe(true)
    })

    it('excludes /admin/users/123', () => {
      expect(shouldExcludeFromI18n('/admin/users/123')).toBe(true)
    })

    it('excludes /vendor/dashboard', () => {
      expect(shouldExcludeFromI18n('/vendor/dashboard')).toBe(true)
    })

    it('excludes /vendor/listings', () => {
      expect(shouldExcludeFromI18n('/vendor/listings')).toBe(true)
    })

    it('excludes /vendor/listings/new', () => {
      expect(shouldExcludeFromI18n('/vendor/listings/new')).toBe(true)
    })

    it('excludes /vendor/bookings', () => {
      expect(shouldExcludeFromI18n('/vendor/bookings')).toBe(true)
    })

    it('excludes /vendor/bookings/abc', () => {
      expect(shouldExcludeFromI18n('/vendor/bookings/abc')).toBe(true)
    })

    it('excludes /vendor/messages', () => {
      expect(shouldExcludeFromI18n('/vendor/messages')).toBe(true)
    })

    it('excludes /vendor/onboarding', () => {
      expect(shouldExcludeFromI18n('/vendor/onboarding')).toBe(true)
    })

    it('excludes /vendor/payouts', () => {
      expect(shouldExcludeFromI18n('/vendor/payouts')).toBe(true)
    })

    it('excludes /vendor/reviews', () => {
      expect(shouldExcludeFromI18n('/vendor/reviews')).toBe(true)
    })

    it('excludes /vendor/settings', () => {
      expect(shouldExcludeFromI18n('/vendor/settings')).toBe(true)
    })

    it('excludes /dashboard', () => {
      expect(shouldExcludeFromI18n('/dashboard')).toBe(true)
    })

    it('excludes /wallet', () => {
      expect(shouldExcludeFromI18n('/wallet')).toBe(true)
    })

    it('excludes /wallet?page=2 path (prefix match on /wallet)', () => {
      expect(shouldExcludeFromI18n('/wallet/anything')).toBe(true)
    })

    it('excludes /support', () => {
      expect(shouldExcludeFromI18n('/support')).toBe(true)
    })

    it('excludes /support/123', () => {
      expect(shouldExcludeFromI18n('/support/123')).toBe(true)
    })

    it('excludes /checkout', () => {
      expect(shouldExcludeFromI18n('/checkout')).toBe(true)
    })

    it('excludes /bookings', () => {
      expect(shouldExcludeFromI18n('/bookings')).toBe(true)
    })

    it('excludes /bookings/123', () => {
      expect(shouldExcludeFromI18n('/bookings/123')).toBe(true)
    })

    it('excludes /wishlist', () => {
      expect(shouldExcludeFromI18n('/wishlist')).toBe(true)
    })

    it('excludes /api', () => {
      expect(shouldExcludeFromI18n('/api')).toBe(true)
    })

    it('excludes /api/webhooks/razorpay', () => {
      expect(shouldExcludeFromI18n('/api/webhooks/razorpay')).toBe(true)
    })
  })

  describe('public routes (should return false — i18n rewriting applies)', () => {
    it('allows / (home)', () => {
      expect(shouldExcludeFromI18n('/')).toBe(false)
    })

    it('allows /search', () => {
      expect(shouldExcludeFromI18n('/search')).toBe(false)
    })

    it('allows /adventure/rafting-in-rishikesh', () => {
      expect(shouldExcludeFromI18n('/adventure/rafting-in-rishikesh')).toBe(false)
    })

    it('allows /experience/some-slug', () => {
      expect(shouldExcludeFromI18n('/experience/some-slug')).toBe(false)
    })

    it('allows /sign-in', () => {
      expect(shouldExcludeFromI18n('/sign-in')).toBe(false)
    })

    it('allows /cancellation-policy', () => {
      expect(shouldExcludeFromI18n('/cancellation-policy')).toBe(false)
    })

    it('allows /hi (locale prefix — not an excluded route)', () => {
      expect(shouldExcludeFromI18n('/hi')).toBe(false)
    })

    it('allows /hi/search', () => {
      expect(shouldExcludeFromI18n('/hi/search')).toBe(false)
    })

    it('allows /vendor (public vendor listing page)', () => {
      // /vendor without a sub-path is the public vendor directory
      expect(shouldExcludeFromI18n('/vendor')).toBe(false)
    })
  })

  describe('EXCLUDED_PREFIXES constant', () => {
    it('contains all 16 excluded prefixes', () => {
      expect(EXCLUDED_PREFIXES).toHaveLength(16)
    })

    it('includes /wallet', () => {
      expect(EXCLUDED_PREFIXES).toContain('/wallet')
    })

    it('includes /wishlist', () => {
      expect(EXCLUDED_PREFIXES).toContain('/wishlist')
    })

    it('includes /support', () => {
      expect(EXCLUDED_PREFIXES).toContain('/support')
    })

    it('includes /admin', () => {
      expect(EXCLUDED_PREFIXES).toContain('/admin')
    })

    it('includes /api', () => {
      expect(EXCLUDED_PREFIXES).toContain('/api')
    })
  })
})
