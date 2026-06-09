/**
 * E2E — Compare tray + dedicated /compare page (issue 20, DECISION D10).
 *
 * Compare is guest-friendly: the selection is backed entirely by localStorage
 * (no auth, no DB write — slugs only, max 3) and surfaced via a "Compare" toggle
 * on every Experience card plus a sticky tray that links to the dedicated
 * /compare side-by-side page. These specs run UNAUTHENTICATED.
 *
 * Coverage:
 *  - Selecting up to 3 cards surfaces the tray with the running count.
 *  - The /compare page renders a side-by-side table with all the field rows for
 *    each selected Experience.
 *  - /compare is NOINDEX (robots meta), and a planted fixture/unpublished slug
 *    is gated out of the comparison server-side (guardrail D0).
 *
 * Navigations use the DevTools fixture (console-error + axe wcag2a/2aa checks).
 */

import { test, expect } from '../../fixtures/devtools'

const STORAGE_KEY = 'outvers-compare'
const TRAY = 'compare-tray'

/**
 * Collect up to three distinct published Experience slugs from the /search
 * results (real seeded inventory — never fixtures, which the public filter
 * excludes).
 */
async function publishedSlugs(
  page: import('@playwright/test').Page,
  count: number,
): Promise<string[]> {
  await page.goto('/search')
  const hrefs = await page
    .locator('a[href*="/experience/"]')
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    )
  const slugs = Array.from(
    new Set(
      hrefs
        .map((h) => h.match(/\/experience\/([^/?#]+)/)?.[1])
        .filter((s): s is string => Boolean(s)),
    ),
  )
  expect(slugs.length).toBeGreaterThanOrEqual(count)
  return slugs.slice(0, count)
}

test.describe('Compare tray + /compare page (issue 20, logged-out)', () => {
  test('the tray is hidden when nothing is selected', async ({ page }) => {
    await page.goto('/search')
    await expect(page.getByTestId(TRAY)).toHaveCount(0)
  })

  test('selecting cards surfaces the tray with a running count', async ({
    page,
  }) => {
    await page.goto('/search')
    const toggles = page.getByTestId('compare-toggle')
    await expect(toggles.first()).toBeVisible()

    // Toggle the first two cards into the comparison.
    await toggles.nth(0).check()
    const tray = page.getByTestId(TRAY)
    await expect(tray).toBeVisible()
    await expect(tray).toHaveAttribute('data-count', '1')

    await toggles.nth(1).check()
    await expect(tray).toHaveAttribute('data-count', '2')
  })

  test('select up to 3 from cards → tray → /compare shows all field rows', async ({
    page,
  }) => {
    const slugs = await publishedSlugs(page, 3)

    // Seed the selection directly (deterministic; the toggle path is covered
    // above) then open /compare via the tray CTA.
    await page.goto('/search')
    await page.evaluate(
      ([key, list]) => window.localStorage.setItem(key, JSON.stringify(list)),
      [STORAGE_KEY, slugs] as const,
    )
    await page.goto('/search')
    const tray = page.getByTestId(TRAY)
    await expect(tray).toBeVisible()
    await expect(tray).toHaveAttribute('data-count', '3')
    await page.getByTestId('compare-tray-cta').click()

    await expect(page).toHaveURL(/\/compare$/)
    const table = page.getByTestId('compare-table')
    await expect(table).toBeVisible()

    // All three columns render their experience link.
    for (const slug of slugs) {
      await expect(
        table.locator(`a[href*="/experience/${slug}"]`).first(),
      ).toBeVisible()
    }

    // All ten field rows are present.
    for (const field of [
      'price',
      'duration',
      'difficulty',
      'inclusions',
      'cancellation',
      'rating',
      'kyc',
      'minAge',
      'groupSize',
      'vendor',
    ]) {
      await expect(table.locator(`tr[data-field="${field}"]`)).toHaveCount(1)
    }
  })

  test('/compare is NOINDEX (robots meta)', async ({ page }) => {
    const slugs = await publishedSlugs(page, 1)
    await page.goto('/compare')
    await page.evaluate(
      ([key, list]) => window.localStorage.setItem(key, JSON.stringify(list)),
      [STORAGE_KEY, slugs] as const,
    )
    const response = await page.goto('/compare')
    expect(response?.status()).toBe(200)

    const robotsMeta = page.locator('meta[name="robots"]')
    await expect(robotsMeta.first()).toHaveAttribute('content', /noindex/i)
  })

  test('a planted fixture/unpublished slug is gated out of the comparison', async ({
    page,
  }) => {
    const [published] = await publishedSlugs(page, 1)

    await page.goto('/compare')
    await page.evaluate(
      ([key, fixtureSlug, pubSlug]) => {
        window.localStorage.setItem(key, JSON.stringify([fixtureSlug, pubSlug]))
      },
      [STORAGE_KEY, 'commission-scope-fixture-bir-billing', published!] as const,
    )
    await page.goto('/compare')

    const table = page.getByTestId('compare-table')
    await expect(table).toBeVisible()
    // Only the published slug resolves; the fixture is gated out server-side.
    await expect(
      table.locator('a[href*="/experience/commission-scope-fixture-bir-billing"]'),
    ).toHaveCount(0)
    await expect(
      table.locator(`a[href*="/experience/${published}"]`).first(),
    ).toBeVisible()
  })
})
