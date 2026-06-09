/**
 * E2E spot-check for issue 04 — fixture-leak hardening.
 *
 * The admin/E2E fixture Experiences (lib/experiences/fixture-slugs.ts) exist
 * only to drive the Playwright suite; they must NEVER appear on a human-facing
 * surface. This spec asserts the most visible fixture titles ("Review
 * Moderation Fixture", the "admin #27" suffix, "Commission Scope Fixture") are
 * absent from the public surfaces the shared public-filter predicate now
 * guards: the homepage, /search, and the published-only sitemap.
 *
 * Page navigations use the DevTools fixture (console-error + axe checks); the
 * sitemap is a raw document fetch via the request API.
 */

import { test, expect } from '../../fixtures/devtools'

const FIXTURE_TITLE_FRAGMENTS = [
  'Review Moderation Fixture',
  'Commission Scope Fixture',
  'admin #2', // covers "admin #26" / "admin #27" fixture title suffixes
]

const FIXTURE_SLUG_FRAGMENTS = [
  'review-moderation-fixture',
  'commission-scope-fixture',
  'payout-queue-fixture',
  'payout-gate-fixture',
  'refund-queue-fixture',
  'mod-pending-',
  'xsurface-',
]

test.describe('No fixture Experience leaks onto public surfaces (issue 04)', () => {
  test('homepage shows no fixture Experience', async ({ page }) => {
    await page.goto('/')
    const body = (await page.locator('body').innerText()).toLowerCase()
    for (const fragment of FIXTURE_TITLE_FRAGMENTS) {
      expect(body).not.toContain(fragment.toLowerCase())
    }
  })

  test('/search shows no fixture Experience', async ({ page }) => {
    await page.goto('/search')
    const body = (await page.locator('body').innerText()).toLowerCase()
    for (const fragment of FIXTURE_TITLE_FRAGMENTS) {
      expect(body).not.toContain(fragment.toLowerCase())
    }
    // The page's anchor hrefs must not link to any fixture experience slug.
    const hrefs = await page.locator('a[href*="/experience/"]').evaluateAll(
      (els) => els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
    for (const href of hrefs) {
      for (const slugFragment of FIXTURE_SLUG_FRAGMENTS) {
        expect(href).not.toContain(slugFragment)
      }
    }
  })

  test('sitemap lists no fixture Experience URL', async ({ request }) => {
    const response = await request.get('/sitemap-en.xml')
    expect(response.status()).toBe(200)
    const body = await response.text()
    for (const slugFragment of FIXTURE_SLUG_FRAGMENTS) {
      expect(body).not.toContain(`/experience/${slugFragment}`)
    }
  })
})
