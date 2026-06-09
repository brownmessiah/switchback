/**
 * E2E — Recently-viewed rail (issue 12).
 *
 * The recently-viewed feature is guest-friendly: it is backed entirely by
 * localStorage (no auth, no DB write — slugs only) and surfaced on home,
 * /search and the PDP. These specs run UNAUTHENTICATED.
 *
 * Coverage:
 *  - Visiting two PDPs records both; the rail then shows them newest-first.
 *  - The rail is hidden when nothing has been viewed.
 *  - A stale fixture / unpublished slug planted directly in localStorage NEVER
 *    renders (the rail re-gates every slug through lib/experiences/public-filter
 *    server-side — guardrail D0).
 *
 * Navigations use the DevTools fixture (console-error + axe wcag2a/2aa checks).
 */

import { test, expect } from '../../fixtures/devtools'

const RAIL = 'recently-viewed-rail'
const STORAGE_KEY = 'outvers-recently-viewed'

/**
 * Collect two distinct published Experience slugs from the /search results
 * (real seeded inventory — never fixtures, which the public filter excludes).
 */
async function twoPublishedSlugs(page: import('@playwright/test').Page): Promise<[string, string]> {
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
  expect(slugs.length).toBeGreaterThanOrEqual(2)
  return [slugs[0]!, slugs[1]!]
}

test.describe('Recently-viewed rail (issue 12, logged-out)', () => {
  test('the rail is hidden when nothing has been viewed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId(RAIL)).toHaveCount(0)
  })

  test('visiting two PDPs surfaces both in the rail, newest-first', async ({
    page,
  }) => {
    const [first, second] = await twoPublishedSlugs(page)

    // View the first PDP, then the second — so the SECOND is most-recent.
    await page.goto(`/experience/${first}`)
    await expect(page.locator('h1')).toBeVisible()
    await page.goto(`/experience/${second}`)
    await expect(page.locator('h1')).toBeVisible()

    // On the home page the rail now resolves both viewed slugs (client effect
    // → gated server action), most-recent-first.
    await page.goto('/')
    const rail = page.getByTestId(RAIL)
    await expect(rail).toBeVisible()

    const railHrefs = await rail
      .locator('a[href*="/experience/"]')
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
      )
    const railSlugs = railHrefs
      .map((h) => h.match(/\/experience\/([^/?#]+)/)?.[1])
      .filter((s): s is string => Boolean(s))
    // Dedup adjacent (a card may carry more than one anchor) preserving order.
    const ordered = railSlugs.filter((s, i) => railSlugs.indexOf(s) === i)

    expect(ordered).toContain(first)
    expect(ordered).toContain(second)
    // Newest (second) appears before the older (first).
    expect(ordered.indexOf(second)).toBeLessThan(ordered.indexOf(first))
  })

  test('the rail also renders on /search after viewing a PDP', async ({
    page,
  }) => {
    const [first] = await twoPublishedSlugs(page)
    await page.goto(`/experience/${first}`)
    await expect(page.locator('h1')).toBeVisible()

    await page.goto('/search')
    await expect(page.getByTestId(RAIL)).toBeVisible()
  })

  test('a planted fixture/unpublished slug NEVER renders in the rail', async ({
    page,
  }) => {
    const [published] = await twoPublishedSlugs(page)

    // Seed localStorage directly: a known published fixture slug FIRST (most
    // recent) followed by a real published slug. Done before any home-page
    // script runs so the rail reads exactly this list.
    await page.goto('/')
    await page.evaluate(
      ([key, fixtureSlug, pubSlug]) => {
        window.localStorage.setItem(key, JSON.stringify([fixtureSlug, pubSlug]))
      },
      [STORAGE_KEY, 'commission-scope-fixture-bir-billing', published] as const,
    )

    // Reload so the rail's effect reads the planted list and calls the gated
    // server action.
    await page.goto('/')
    const rail = page.getByTestId(RAIL)
    await expect(rail).toBeVisible()

    // Only the published slug resolves; the fixture is gated out server-side.
    await expect(
      rail.locator('a[href*="/experience/commission-scope-fixture-bir-billing"]'),
    ).toHaveCount(0)
    await expect(
      rail.locator(`a[href*="/experience/${published}"]`).first(),
    ).toBeVisible()
  })
})
