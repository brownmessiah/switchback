/**
 * E2E for the public legal pages (issue 07): /terms, /privacy,
 * /refund-cancellation, /vendor-terms.
 *
 * Each page must:
 *   - return 200 and render a single H1 (the page title) + a breadcrumb,
 *   - show the visible "pending final legal review" working-draft notice,
 *   - be indexable (no robots noindex) and emit a BreadcrumbList JSON-LD,
 *   - be reachable from the footer "Legal" links.
 *
 * All tests run through the DevTools fixture (axe wcag2a+wcag2aa +
 * console-error gating).
 */

import { test, expect } from '../../fixtures/devtools'

const LEGAL_PAGES = [
  { path: '/terms', title: 'Terms of Service', footerLabel: 'Terms of Service' },
  { path: '/privacy', title: 'Privacy Policy', footerLabel: 'Privacy Policy' },
  {
    path: '/refund-cancellation',
    title: 'Refund & Cancellation Policy',
    footerLabel: 'Refund & cancellation',
  },
  { path: '/vendor-terms', title: 'Vendor Terms', footerLabel: 'Vendor terms' },
] as const

test.describe('Legal pages — public, crawlable, pending-review drafts', () => {
  for (const { path, title } of LEGAL_PAGES) {
    test(`${path} renders 200, H1, breadcrumb, review notice, and is indexable`, async ({
      page,
    }) => {
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)

      const h1 = page.locator('h1')
      await expect(h1).toHaveCount(1)
      await expect(h1).toContainText(title)

      // Breadcrumb present.
      await expect(
        page.getByRole('navigation', { name: 'Breadcrumb' }),
      ).toBeVisible()

      // The visible "pending final legal review" working-draft notice.
      await expect(
        page.getByText(/pending final legal review/i).first(),
      ).toBeVisible()

      // Indexable: no robots noindex in the served HTML, and the title is
      // server-rendered (crawlable).
      const html = await response!.text()
      expect(html).not.toMatch(/<meta[^>]+name=["']robots["'][^>]*noindex/i)
      expect(html).toContain(title)

      // BreadcrumbList JSON-LD emitted.
      const ld = page.locator('script[type="application/ld+json"]')
      expect(await ld.count()).toBeGreaterThanOrEqual(1)
      expect(await ld.first().textContent()).toContain('BreadcrumbList')
    })
  }

  test('footer "Legal" links resolve to each legal page', async ({ page }) => {
    await page.goto('/')
    const footerNav = page.getByRole('navigation', { name: 'Footer navigation' })

    for (const { path, footerLabel } of LEGAL_PAGES) {
      await expect(
        footerNav.getByRole('link', { name: footerLabel }),
      ).toHaveAttribute('href', path)
    }

    // The existing /cancellation-policy link is preserved alongside the new ones.
    await expect(
      footerNav.getByRole('link', { name: /cancellation policy|refund policy/i }).first(),
    ).toBeVisible()
  })

  test('/refund-cancellation links to the existing /cancellation-policy calculator', async ({
    page,
  }) => {
    await page.goto('/refund-cancellation')
    await expect(
      page.getByRole('link', { name: /cancellation policy/i }).first(),
    ).toHaveAttribute('href', '/cancellation-policy')
  })

  test('all four legal routes are in the en sitemap', async ({ page }) => {
    await page.goto('/terms')
    const sitemap = await page.request.get('/sitemap-en.xml')
    expect(sitemap.status()).toBe(200)
    const xml = await sitemap.text()
    for (const { path } of LEGAL_PAGES) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]*${path}</loc>`))
    }
  })
})
