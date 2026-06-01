import { describe, expect, it } from 'vitest'

import { listActivities } from '@/lib/activities/registry'
import { listCategories } from '@/lib/activities/queries'

import {
  generateActivityLandingUrls,
  generateCategoryLandingUrls,
  getSiteUrl,
} from './sitemap'

describe('generateActivityLandingUrls', () => {
  it('emits one /activities/{slug} entry per registry activity', () => {
    const urls = generateActivityLandingUrls('en')
    expect(urls).toHaveLength(listActivities().length)
    const siteUrl = getSiteUrl()
    const urlStrings = urls.map((u) => u.url)
    expect(urlStrings).toContain(`${siteUrl}/activities/rafting`)
    expect(urlStrings).toContain(`${siteUrl}/activities/scuba-diving`)
  })

  it('prefixes non-default locales with /{locale}/', () => {
    const urls = generateActivityLandingUrls('hi')
    for (const entry of urls) {
      const path = new URL(entry.url).pathname
      expect(path).toMatch(/^\/hi\/activities\//)
    }
  })

  it('English entries have no /en/ prefix and are absolute', () => {
    const urls = generateActivityLandingUrls('en')
    for (const entry of urls) {
      expect(entry.url).not.toContain('/en/')
      expect(entry.url).toMatch(/^https?:\/\//)
      expect(entry.priority).toBeGreaterThanOrEqual(0)
      expect(entry.priority).toBeLessThanOrEqual(1)
    }
  })
})

describe('generateCategoryLandingUrls', () => {
  it('emits one /category/{slug} entry per non-empty category', () => {
    const urls = generateCategoryLandingUrls('en')
    expect(urls).toHaveLength(listCategories().length)
    const siteUrl = getSiteUrl()
    const urlStrings = urls.map((u) => u.url)
    expect(urlStrings).toContain(`${siteUrl}/category/water`)
    expect(urlStrings).toContain(`${siteUrl}/category/mountain`)
  })

  it('excludes the empty urban category', () => {
    const urls = generateCategoryLandingUrls('en')
    const urlStrings = urls.map((u) => u.url)
    expect(urlStrings.some((u) => u.endsWith('/category/urban'))).toBe(false)
  })

  it('prefixes non-default locales with /{locale}/', () => {
    const urls = generateCategoryLandingUrls('hi')
    for (const entry of urls) {
      const path = new URL(entry.url).pathname
      expect(path).toMatch(/^\/hi\/category\//)
    }
  })
})
