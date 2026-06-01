import { describe, expect, it } from 'vitest'

import { getSiteUrl } from '@/lib/seo/sitemap'

import robots from './robots'

describe('app/robots.ts (issue #13)', () => {
  it('allows all user agents to crawl the root', () => {
    const result = robots()
    expect(Array.isArray(result.rules)).toBe(false)
    const rules = result.rules as { userAgent?: string; allow?: string | string[]; disallow?: string | string[] }
    expect(rules.userAgent).toBe('*')
    const allow = Array.isArray(rules.allow) ? rules.allow : [rules.allow]
    expect(allow).toContain('/')
  })

  it('points the sitemap at the absolute /sitemap.xml URL', () => {
    const result = robots()
    expect(result.sitemap).toBe(`${getSiteUrl()}/sitemap.xml`)
  })

  it('disallows the authed / non-public surfaces', () => {
    const result = robots()
    const rules = result.rules as { disallow?: string | string[] }
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow]

    for (const path of [
      '/admin/',
      '/dashboard',
      '/checkout',
      '/bookings',
      '/vendor/dashboard',
      '/vendor/listings',
      '/api/',
    ]) {
      expect(disallow).toContain(path)
    }
  })

  it('does NOT disallow public vendor storefronts (/vendor/ bare prefix)', () => {
    const result = robots()
    const rules = result.rules as { disallow?: string | string[] }
    const disallow = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow]
    // A bare '/vendor/' or '/vendor' would block /vendor/{slug} storefronts.
    expect(disallow).not.toContain('/vendor/')
    expect(disallow).not.toContain('/vendor')
  })
})
