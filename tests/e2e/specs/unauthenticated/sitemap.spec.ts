/**
 * E2E for the dynamic sitemap + robots.txt (issue #13).
 *
 * - /sitemap-en.xml (rewritten to /api/sitemap/en) must include at least one
 *   dynamic /experience/ URL — proving the DB-driven generators are wired in.
 * - /robots.txt must return 200 and carry a Sitemap: line.
 *
 * These are raw document fetches (not page navigations), so they bypass the
 * DevTools fixture's DOM-oriented checks and use Playwright's request API.
 */

import { test, expect } from '@playwright/test'

test.describe('Dynamic sitemap', () => {
  test('/sitemap-en.xml includes an /experience/ URL', async ({ request }) => {
    const response = await request.get('/sitemap-en.xml')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('xml')

    const body = await response.text()
    expect(body).toContain('<urlset')
    // At least one dynamic Experience detail URL is present.
    expect(body).toMatch(/<loc>[^<]*\/experience\/[^<]+<\/loc>/)
  })

  test('/sitemap.xml index references the per-locale sitemaps', async ({
    request,
  }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.status()).toBe(200)
    const body = await response.text()
    expect(body).toContain('<sitemapindex')
    expect(body).toContain('/sitemap-en.xml')
  })
})

test.describe('robots.txt', () => {
  test('returns 200 with a Sitemap: line and disallows the authed surface', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)

    const body = await response.text()
    expect(body).toMatch(/Sitemap:\s*https?:\/\/[^\s]+\/sitemap\.xml/i)
    expect(body).toMatch(/User-Agent:\s*\*/i)
    expect(body).toMatch(/Disallow:\s*\/admin\//i)
    expect(body).toMatch(/Disallow:\s*\/api\//i)
  })
})
