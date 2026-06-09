/**
 * E2E for the public /vendor-partner partner page (issue 06).
 *
 * Unauthenticated funnel:
 *   - /vendor-partner → 200, renders all sections (hero, benefits, who-can-join,
 *     documents-by-KYC-tier, verification, Booking & Payout flow), the ADR-0007
 *     tier badge strings, and a breadcrumb. Indexable (no noindex). Axe clean.
 *   - "Start Vendor Onboarding" CTA → /vendor/onboarding.
 *   - nav / hero / footer "List your experience" → /vendor-partner.
 *   - /vendor-partner is in the en sitemap and NOT robots-disallowed.
 *
 * All tests run through the DevTools fixture (axe wcag2a+wcag2aa +
 * console-error gating). The indexability/sitemap/robots checks use
 * `page.request` so they share the fixture's per-test gating.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('/vendor-partner — public partner page', () => {
  test('renders 200, all sections, KYC tier badges, and a breadcrumb', async ({ page }) => {
    const response = await page.goto('/vendor-partner')
    expect(response?.status()).toBe(200)

    // Single H1 = the hero "List your adventure business on Outvers".
    const h1 = page.locator('h1')
    await expect(h1).toHaveCount(1)
    await expect(h1).toContainText('List your adventure business on Outvers')

    // Breadcrumb present.
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()

    // Section headings present (benefits, who-can-join, documents,
    // verification, Booking & Payout).
    await expect(page.getByRole('heading', { name: 'Why list on Outvers' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Who can join' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Documents required, by verification tier' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'How verification works' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'How Bookings and Payouts work' }),
    ).toBeVisible()

    // ADR-0007 KYC tier badge strings render verbatim.
    await expect(page.getByText('Identity verified', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Business verified', { exact: true }).first()).toBeVisible()

    // Crawlable: a BreadcrumbList JSON-LD is emitted.
    const breadcrumbLd = page.locator('script[type="application/ld+json"]')
    expect(await breadcrumbLd.count()).toBeGreaterThanOrEqual(1)
    const ldText = await breadcrumbLd.first().textContent()
    expect(ldText).toContain('BreadcrumbList')

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-partner.png',
      fullPage: true,
    })
  })

  test('"Start Vendor Onboarding" CTA routes to /vendor/onboarding', async ({ page }) => {
    await page.goto('/vendor-partner')
    const ctas = page.getByRole('link', { name: 'Start Vendor Onboarding' })
    expect(await ctas.count()).toBeGreaterThanOrEqual(1)
    await expect(ctas.first()).toHaveAttribute('href', '/vendor/onboarding')
  })

  test('nav + footer "List your experience" route to /vendor-partner', async ({ page }) => {
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(
      nav.getByRole('link', { name: 'List your experience' }),
    ).toHaveAttribute('href', '/vendor-partner')

    const footerNav = page.getByRole('navigation', { name: 'Footer navigation' })
    await expect(
      footerNav.getByRole('link', { name: 'List your experience' }),
    ).toHaveAttribute('href', '/vendor-partner')
  })

  test('hero "List Your Experience" CTA routes to /vendor-partner', async ({ page }) => {
    await page.goto('/')
    const cta = page.getByRole('link', { name: 'List Your Experience' })
    await expect(cta).toHaveAttribute('href', '/vendor-partner')
  })

  test('is indexable (no noindex), in the en sitemap, and not robots-disallowed', async ({
    page,
  }) => {
    // Navigate first so the fixture's axe scan runs on a real page.
    const pageResponse = await page.goto('/vendor-partner')
    expect(pageResponse?.status()).toBe(200)

    // No robots noindex directive in the served HTML.
    const html = await pageResponse!.text()
    expect(html).not.toMatch(/<meta[^>]+name=["']robots["'][^>]*noindex/i)
    // The hero headline is server-rendered into the HTML (crawlable).
    expect(html).toContain('List your adventure business on Outvers')

    // Present in the en sitemap.
    const sitemap = await page.request.get('/sitemap-en.xml')
    expect(sitemap.status()).toBe(200)
    expect(await sitemap.text()).toMatch(/<loc>[^<]*\/vendor-partner<\/loc>/)

    // robots disallows /vendor/dashboard etc. but NOT the bare /vendor-partner.
    const robots = await page.request.get('/robots.txt')
    expect((await robots.text())).not.toMatch(/Disallow:\s*\/vendor-partner/i)
  })
})
