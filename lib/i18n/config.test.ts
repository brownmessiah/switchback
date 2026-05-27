import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCALE,
  LAUNCH_LOCALES,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  detectLocale,
  getLocaleFromCookie,
  isValidLocale,
  setLocaleCookie,
} from './config'

// ---------------------------------------------------------------------------
// SUPPORTED_LOCALES + constants
// ---------------------------------------------------------------------------

describe('SUPPORTED_LOCALES', () => {
  it('contains exactly 5 locale codes', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(5)
  })

  it('contains en, hi, ta, mr, bn', () => {
    expect(SUPPORTED_LOCALES).toContain('en')
    expect(SUPPORTED_LOCALES).toContain('hi')
    expect(SUPPORTED_LOCALES).toContain('ta')
    expect(SUPPORTED_LOCALES).toContain('mr')
    expect(SUPPORTED_LOCALES).toContain('bn')
  })

  it('does NOT contain unsupported codes', () => {
    expect(SUPPORTED_LOCALES).not.toContain('fr')
    expect(SUPPORTED_LOCALES).not.toContain('de')
    expect(SUPPORTED_LOCALES).not.toContain('te')
  })
})

describe('DEFAULT_LOCALE', () => {
  it('is "en"', () => {
    expect(DEFAULT_LOCALE).toBe('en')
  })
})

describe('LAUNCH_LOCALES', () => {
  it('contains exactly en and hi', () => {
    expect([...LAUNCH_LOCALES]).toEqual(['en', 'hi'])
  })

  it('is a subset of SUPPORTED_LOCALES', () => {
    for (const code of LAUNCH_LOCALES) {
      expect((SUPPORTED_LOCALES as readonly string[]).includes(code)).toBe(true)
    }
  })

  it('does not contain infrastructure locales ta, mr, bn', () => {
    expect(LAUNCH_LOCALES).not.toContain('ta')
    expect(LAUNCH_LOCALES).not.toContain('mr')
    expect(LAUNCH_LOCALES).not.toContain('bn')
  })
})

describe('LOCALE_NAMES', () => {
  it('has an entry for every supported locale', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(LOCALE_NAMES[code]).toBeDefined()
      expect(typeof LOCALE_NAMES[code]).toBe('string')
      expect(LOCALE_NAMES[code].length).toBeGreaterThan(0)
    }
  })

  it('maps "en" to "English"', () => {
    expect(LOCALE_NAMES.en).toBe('English')
  })

  it('maps "hi" to Hindi script name', () => {
    expect(LOCALE_NAMES.hi).toBe('हिन्दी')
  })
})

// ---------------------------------------------------------------------------
// isValidLocale
// ---------------------------------------------------------------------------

describe('isValidLocale()', () => {
  it('returns true for all supported locales', () => {
    for (const code of SUPPORTED_LOCALES) {
      expect(isValidLocale(code)).toBe(true)
    }
  })

  it('returns false for unsupported locale codes', () => {
    expect(isValidLocale('fr')).toBe(false)
    expect(isValidLocale('de')).toBe(false)
    expect(isValidLocale('te')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isValidLocale('')).toBe(false)
  })

  it('returns false for undefined-like values', () => {
    expect(isValidLocale(undefined as unknown as string)).toBe(false)
    expect(isValidLocale(null as unknown as string)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// getLocaleFromCookie
// ---------------------------------------------------------------------------

describe('getLocaleFromCookie()', () => {
  afterEach(() => {
    document.cookie = 'locale=; max-age=0'
  })

  it('returns DEFAULT_LOCALE when no locale cookie is set', () => {
    document.cookie = 'locale=; max-age=0'
    expect(getLocaleFromCookie()).toBe(DEFAULT_LOCALE)
  })

  it('returns the locale stored in the cookie when it is valid', () => {
    document.cookie = 'locale=hi'
    expect(getLocaleFromCookie()).toBe('hi')
  })

  it('returns DEFAULT_LOCALE when the cookie contains an unsupported locale', () => {
    document.cookie = 'locale=fr'
    expect(getLocaleFromCookie()).toBe(DEFAULT_LOCALE)
  })

  it('returns DEFAULT_LOCALE when locale cookie value is empty', () => {
    document.cookie = 'locale='
    expect(getLocaleFromCookie()).toBe(DEFAULT_LOCALE)
  })

  it('reads the correct locale when multiple cookies are present', () => {
    document.cookie = 'other=foo'
    document.cookie = 'locale=ta'
    expect(getLocaleFromCookie()).toBe('ta')
  })
})

// ---------------------------------------------------------------------------
// setLocaleCookie
// ---------------------------------------------------------------------------

describe('setLocaleCookie()', () => {
  afterEach(() => {
    document.cookie = 'locale=; max-age=0'
  })

  it('sets the locale cookie to the given locale', () => {
    setLocaleCookie('hi')
    expect(document.cookie).toContain('locale=hi')
  })

  it('sets cookie for "en"', () => {
    setLocaleCookie('en')
    expect(document.cookie).toContain('locale=en')
  })

  it('sets cookie for "bn"', () => {
    setLocaleCookie('bn')
    expect(document.cookie).toContain('locale=bn')
  })
})

// ---------------------------------------------------------------------------
// detectLocale
// ---------------------------------------------------------------------------

describe('detectLocale()', () => {
  const originalLanguages = Object.getOwnPropertyDescriptor(
    navigator,
    'languages',
  )
  const originalLanguage = Object.getOwnPropertyDescriptor(
    navigator,
    'language',
  )

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    if (originalLanguages) {
      Object.defineProperty(navigator, 'languages', originalLanguages)
    }
    if (originalLanguage) {
      Object.defineProperty(navigator, 'language', originalLanguage)
    }
  })

  it('returns locale from localStorage when valid', () => {
    localStorage.setItem('locale', 'ta')
    expect(detectLocale()).toBe('ta')
  })

  it('ignores localStorage when the stored value is unsupported', () => {
    localStorage.setItem('locale', 'fr')
    Object.defineProperty(navigator, 'languages', {
      value: ['hi-IN'],
      configurable: true,
    })
    expect(detectLocale()).toBe('hi')
  })

  it('falls back to navigator.languages when localStorage has no locale', () => {
    Object.defineProperty(navigator, 'languages', {
      value: ['bn-BD', 'en-US'],
      configurable: true,
    })
    expect(detectLocale()).toBe('bn')
  })

  it('extracts base language code from a tag (e.g. "mr-IN" -> "mr")', () => {
    Object.defineProperty(navigator, 'languages', {
      value: ['mr-IN'],
      configurable: true,
    })
    expect(detectLocale()).toBe('mr')
  })

  it('returns DEFAULT_LOCALE when no match found', () => {
    Object.defineProperty(navigator, 'languages', {
      value: ['fr-FR', 'de-DE'],
      configurable: true,
    })
    expect(detectLocale()).toBe(DEFAULT_LOCALE)
  })

  it('returns DEFAULT_LOCALE when navigator.languages is empty', () => {
    Object.defineProperty(navigator, 'languages', {
      value: [],
      configurable: true,
    })
    Object.defineProperty(navigator, 'language', {
      value: 'fr',
      configurable: true,
    })
    expect(detectLocale()).toBe(DEFAULT_LOCALE)
  })

  it('prefers localStorage over navigator.languages', () => {
    localStorage.setItem('locale', 'bn')
    Object.defineProperty(navigator, 'languages', {
      value: ['hi-IN'],
      configurable: true,
    })
    expect(detectLocale()).toBe('bn')
  })
})
