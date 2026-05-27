import { describe, expect, it } from 'vitest'

import { generateAlternates, getAbsoluteUrl, PUBLIC_ROUTES } from './hreflang'

describe('getAbsoluteUrl', () => {
  it('returns absolute URL with domain for a pathname', () => {
    const result = getAbsoluteUrl('/search')
    expect(result).toMatch(/^https?:\/\//)
    expect(result).toContain('/search')
  })

  it('strips trailing slash from domain before joining', () => {
    const result = getAbsoluteUrl('/adventure/rafting-in-rishikesh')
    // Should not have double slashes (except in protocol)
    expect(result.replace('https://', '').replace('http://', '')).not.toContain('//')
  })

  it('handles root path', () => {
    const result = getAbsoluteUrl('/')
    expect(result).toMatch(/^https?:\/\/[^/]+\/$/)
  })

  it('handles empty string as root', () => {
    const result = getAbsoluteUrl('')
    expect(result).toMatch(/^https?:\/\//)
  })
})

describe('generateAlternates', () => {
  describe('for English (default) locale', () => {
    it('returns canonical pointing to the English URL (no locale prefix)', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.canonical).toBe(getAbsoluteUrl('/search'))
    })

    it('returns languages with en, hi, and x-default', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.languages).toHaveProperty('en')
      expect(result.languages).toHaveProperty('hi')
      expect(result.languages).toHaveProperty('x-default')
    })

    it('x-default points to the English (un-prefixed) URL', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.languages['x-default']).toBe(getAbsoluteUrl('/search'))
    })

    it('en points to the un-prefixed URL', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.languages['en']).toBe(getAbsoluteUrl('/search'))
    })

    it('hi points to the /hi/ prefixed URL', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.languages['hi']).toBe(getAbsoluteUrl('/hi/search'))
    })
  })

  describe('for Hindi locale', () => {
    it('returns canonical pointing to the Hindi URL (with /hi/ prefix)', () => {
      const result = generateAlternates('/search', 'hi')
      expect(result.canonical).toBe(getAbsoluteUrl('/hi/search'))
    })

    it('en still points to the un-prefixed URL', () => {
      const result = generateAlternates('/search', 'hi')
      expect(result.languages['en']).toBe(getAbsoluteUrl('/search'))
    })

    it('hi points to the /hi/ prefixed URL', () => {
      const result = generateAlternates('/search', 'hi')
      expect(result.languages['hi']).toBe(getAbsoluteUrl('/hi/search'))
    })

    it('x-default still points to English', () => {
      const result = generateAlternates('/search', 'hi')
      expect(result.languages['x-default']).toBe(getAbsoluteUrl('/search'))
    })
  })

  describe('for adventure/[slug] route', () => {
    it('canonical on English is the un-prefixed URL', () => {
      const result = generateAlternates('/adventure/rafting-in-rishikesh', 'en')
      expect(result.canonical).toBe(getAbsoluteUrl('/adventure/rafting-in-rishikesh'))
    })

    it('canonical on Hindi is the /hi/ prefixed URL', () => {
      const result = generateAlternates('/adventure/rafting-in-rishikesh', 'hi')
      expect(result.canonical).toBe(getAbsoluteUrl('/hi/adventure/rafting-in-rishikesh'))
    })
  })

  describe('for home page (root)', () => {
    it('canonical on English points to root', () => {
      const result = generateAlternates('/', 'en')
      expect(result.canonical).toBe(getAbsoluteUrl('/'))
    })

    it('canonical on Hindi points to /hi/', () => {
      const result = generateAlternates('/', 'hi')
      expect(result.canonical).toBe(getAbsoluteUrl('/hi/'))
    })

    it('hi alternate points to /hi/', () => {
      const result = generateAlternates('/', 'en')
      expect(result.languages['hi']).toBe(getAbsoluteUrl('/hi/'))
    })
  })

  describe('future locale support', () => {
    it('uses all LAUNCH_LOCALES — adding a locale to the list includes it automatically', () => {
      const result = generateAlternates('/search', 'en')
      // At minimum en and hi should be present
      expect(Object.keys(result.languages)).toContain('en')
      expect(Object.keys(result.languages)).toContain('hi')
      expect(Object.keys(result.languages)).toContain('x-default')
    })
  })

  describe('absolute URLs', () => {
    it('all hreflang URLs are absolute', () => {
      const result = generateAlternates('/search', 'en')
      for (const url of Object.values(result.languages)) {
        expect(url).toMatch(/^https?:\/\//)
      }
    })

    it('canonical URL is absolute', () => {
      const result = generateAlternates('/search', 'en')
      expect(result.canonical).toMatch(/^https?:\/\//)
    })
  })
})

describe('PUBLIC_ROUTES', () => {
  it('exports a list of public route pathnames', () => {
    expect(Array.isArray(PUBLIC_ROUTES)).toBe(true)
    expect(PUBLIC_ROUTES.length).toBeGreaterThan(0)
  })

  it('includes known public routes', () => {
    expect(PUBLIC_ROUTES).toContain('/')
    expect(PUBLIC_ROUTES).toContain('/search')
    expect(PUBLIC_ROUTES).toContain('/sign-in')
    expect(PUBLIC_ROUTES).toContain('/cancellation-policy')
  })

  it('includes dynamic route patterns', () => {
    // Dynamic routes use pattern syntax for sitemap generation
    const hasAdventure = PUBLIC_ROUTES.some((r) => r.includes('adventure'))
    const hasExperience = PUBLIC_ROUTES.some((r) => r.includes('experience'))
    const hasVendor = PUBLIC_ROUTES.some((r) => r.includes('vendor'))
    expect(hasAdventure).toBe(true)
    expect(hasExperience).toBe(true)
    expect(hasVendor).toBe(true)
  })
})
