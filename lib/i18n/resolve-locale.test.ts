import { describe, expect, it } from 'vitest'

import { resolveLocale } from './resolve-locale'

// ---------------------------------------------------------------------------
// resolveLocale — priority-order locale resolution
// ---------------------------------------------------------------------------

describe('resolveLocale()', () => {
  describe('priority 1: URL path prefix (requestLocale)', () => {
    it('returns requestLocale when valid', () => {
      expect(
        resolveLocale({
          requestLocale: 'hi',
          cookieLocale: 'ta',
          acceptLanguage: 'bn',
        }),
      ).toBe('hi')
    })

    it('ignores requestLocale when invalid', () => {
      expect(
        resolveLocale({
          requestLocale: 'fr',
          cookieLocale: 'ta',
          acceptLanguage: undefined,
        }),
      ).toBe('ta')
    })

    it('ignores requestLocale when undefined', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: 'mr',
          acceptLanguage: undefined,
        }),
      ).toBe('mr')
    })
  })

  describe('priority 2: cookie value', () => {
    it('returns cookieLocale when requestLocale is absent', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: 'bn',
          acceptLanguage: 'hi-IN',
        }),
      ).toBe('bn')
    })

    it('ignores cookieLocale when invalid', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: 'de',
          acceptLanguage: 'ta-IN',
        }),
      ).toBe('ta')
    })
  })

  describe('priority 3: Accept-Language header', () => {
    it('parses Accept-Language and returns first matching locale', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: undefined,
          acceptLanguage: 'fr-FR, hi-IN;q=0.9, en-US;q=0.8',
        }),
      ).toBe('hi')
    })

    it('extracts base language code from full tag', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: undefined,
          acceptLanguage: 'mr-IN',
        }),
      ).toBe('mr')
    })

    it('falls back to default when no Accept-Language locale matches', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: undefined,
          acceptLanguage: 'fr-FR, de-DE',
        }),
      ).toBe('en')
    })
  })

  describe('priority 4: default fallback', () => {
    it('returns "en" when all inputs are undefined', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: undefined,
          acceptLanguage: undefined,
        }),
      ).toBe('en')
    })

    it('returns "en" when all inputs are invalid', () => {
      expect(
        resolveLocale({
          requestLocale: 'zz',
          cookieLocale: 'xx',
          acceptLanguage: 'fr-FR',
        }),
      ).toBe('en')
    })
  })

  describe('full priority chain', () => {
    it('requestLocale > cookieLocale > acceptLanguage', () => {
      // All valid — requestLocale wins
      expect(
        resolveLocale({
          requestLocale: 'ta',
          cookieLocale: 'mr',
          acceptLanguage: 'bn',
        }),
      ).toBe('ta')
    })

    it('cookieLocale > acceptLanguage when requestLocale absent', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: 'mr',
          acceptLanguage: 'bn',
        }),
      ).toBe('mr')
    })

    it('acceptLanguage wins when requestLocale and cookieLocale both absent', () => {
      expect(
        resolveLocale({
          requestLocale: undefined,
          cookieLocale: undefined,
          acceptLanguage: 'bn-BD, en-US;q=0.9',
        }),
      ).toBe('bn')
    })
  })
})
