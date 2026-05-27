import { describe, expect, it } from 'vitest'

import {
  generateSitemapUrls,
  getSiteUrl,
  STATIC_PUBLIC_PATHS,
} from './sitemap'

describe('getSiteUrl', () => {
  it('returns a URL string', () => {
    const url = getSiteUrl()
    expect(typeof url).toBe('string')
    expect(url).toMatch(/^https?:\/\//)
  })

  it('has no trailing slash', () => {
    const url = getSiteUrl()
    expect(url).not.toMatch(/\/$/)
  })
})

describe('STATIC_PUBLIC_PATHS', () => {
  it('includes home, search, sign-in, cancellation-policy', () => {
    expect(STATIC_PUBLIC_PATHS).toContain('/')
    expect(STATIC_PUBLIC_PATHS).toContain('/search')
    expect(STATIC_PUBLIC_PATHS).toContain('/sign-in')
    expect(STATIC_PUBLIC_PATHS).toContain('/cancellation-policy')
  })
})

describe('generateSitemapUrls', () => {
  describe('for English locale', () => {
    it('returns URLs without locale prefix', () => {
      const urls = generateSitemapUrls('en')
      for (const entry of urls) {
        // English URLs should NOT have /en/ prefix
        expect(entry.url).not.toContain('/en/')
      }
    })

    it('returns absolute URLs', () => {
      const urls = generateSitemapUrls('en')
      for (const entry of urls) {
        expect(entry.url).toMatch(/^https?:\/\//)
      }
    })

    it('includes static public paths', () => {
      const urls = generateSitemapUrls('en')
      const urlStrings = urls.map((u) => u.url)
      const siteUrl = getSiteUrl()
      expect(urlStrings).toContain(`${siteUrl}/`)
      expect(urlStrings).toContain(`${siteUrl}/search`)
      expect(urlStrings).toContain(`${siteUrl}/sign-in`)
      expect(urlStrings).toContain(`${siteUrl}/cancellation-policy`)
    })

    it('each entry has a lastModified date', () => {
      const urls = generateSitemapUrls('en')
      for (const entry of urls) {
        expect(entry.lastModified).toBeInstanceOf(Date)
      }
    })

    it('each entry has a changeFrequency', () => {
      const urls = generateSitemapUrls('en')
      const validFrequencies = [
        'always',
        'hourly',
        'daily',
        'weekly',
        'monthly',
        'yearly',
        'never',
      ]
      for (const entry of urls) {
        expect(validFrequencies).toContain(entry.changeFrequency)
      }
    })

    it('each entry has a priority between 0 and 1', () => {
      const urls = generateSitemapUrls('en')
      for (const entry of urls) {
        expect(entry.priority).toBeGreaterThanOrEqual(0)
        expect(entry.priority).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('for Hindi locale', () => {
    it('returns URLs with /hi/ prefix', () => {
      const urls = generateSitemapUrls('hi')
      for (const entry of urls) {
        const path = new URL(entry.url).pathname
        expect(path).toMatch(/^\/hi\//)
      }
    })

    it('returns absolute URLs with correct domain', () => {
      const urls = generateSitemapUrls('hi')
      const siteUrl = getSiteUrl()
      for (const entry of urls) {
        expect(entry.url).toMatch(new RegExp(`^${siteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
      }
    })

    it('includes static public paths with /hi/ prefix', () => {
      const urls = generateSitemapUrls('hi')
      const urlStrings = urls.map((u) => u.url)
      const siteUrl = getSiteUrl()
      expect(urlStrings).toContain(`${siteUrl}/hi/`)
      expect(urlStrings).toContain(`${siteUrl}/hi/search`)
      expect(urlStrings).toContain(`${siteUrl}/hi/sign-in`)
      expect(urlStrings).toContain(`${siteUrl}/hi/cancellation-policy`)
    })
  })

  describe('future locale support', () => {
    it('adding a locale to LAUNCH_LOCALES includes it in sitemaps without code changes', () => {
      // This test verifies the architecture: generateSitemapUrls accepts any locale string
      // and generates correct prefixed URLs. No hardcoded locale checks.
      const urls = generateSitemapUrls('ta')
      for (const entry of urls) {
        const path = new URL(entry.url).pathname
        expect(path).toMatch(/^\/ta\//)
      }
    })
  })
})
