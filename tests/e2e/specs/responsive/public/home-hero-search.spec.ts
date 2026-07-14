/**
 * Responsive verification — the unified hero search bar (home-redesign
 * issue 07 / CR5+CR7; supersedes the single-field spec). Runs under
 * responsive-phone-public (375) + responsive-tablet-public (768). The
 * `[places/activities][participants][Search]` bar GET-posts to /search —
 * `q` alone with zero JS (progressive enhancement), `groupSize` only when
 * the stepper leaves its default — and meets the §8.2 44px coarse-pointer
 * floor.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) gating per test.
 */

import { test, expect } from '../../../fixtures/devtools'

test.describe('home hero search · unified bar (issue 07)', () => {
  test('renders one searchbox and submits to /search?q=', async ({ page }) => {
    await page.goto('/')

    const form = page.getByTestId('home-hero-search')
    await expect(form).toBeVisible()

    const input = form.getByRole('searchbox')
    await expect(input).toBeVisible()
    await input.fill('paragliding')
    await input.press('Enter')
    await page.waitForURL('**/search?q=paragliding')
    expect(new URL(page.url()).pathname).toBe('/search')
  })

  test('participants selection rides along as groupSize and narrows results (CR7)', async ({
    page,
  }) => {
    // Baseline: unfiltered search result count (cards are /experience links
    // inside the labelled results region).
    await page.goto('/search')
    const results = page.getByRole('region', { name: 'Search results' })
    const cards = results.locator('a[href^="/experience/"]')
    await expect(cards.first()).toBeVisible()
    const allCount = await cards.count()

    await page.goto('/')
    const form = page.getByTestId('home-hero-search')
    const plus = form.getByRole('button', { name: /\+$/ })
    // 1 → 20 (the hero ceiling): only ~6 seeds across ALL seed sets have
    // maxGroupSize >= 20 (catalog tops out at 30), safely below the
    // 20-row SEARCH_LIMIT — so the narrowed count can never saturate the
    // page the way a lower threshold would under base+demo seeding.
    for (let i = 0; i < 19; i += 1) {
      await plus.click()
    }
    await form.getByRole('button', { name: 'Search' }).click()
    await page.waitForURL('**/search?**groupSize=20**')

    // Wired end-to-end: parseSearchParams picked it up (facet reflects it)
    // and the result set narrowed.
    await expect(page.getByTestId('facet-groupSize').locator('input')).toHaveValue('20')
    const narrowedResults = page.getByRole('region', { name: 'Search results' })
    const narrowedCards = narrowedResults.locator('a[href^="/experience/"]')
    await expect(narrowedCards.first()).toBeVisible()
    const narrowed = await narrowedCards.count()
    expect(narrowed).toBeGreaterThan(0)
    expect(narrowed).toBeLessThan(allCount)
  })

  test('default participants (1) emits NO groupSize param (canonical URL shape)', async ({
    page,
  }) => {
    await page.goto('/')
    const form = page.getByTestId('home-hero-search')
    await form.getByRole('searchbox').fill('rafting')
    await form.getByRole('button', { name: 'Search' }).click()
    await page.waitForURL('**/search?**')
    const url = new URL(page.url())
    expect(url.searchParams.get('q')).toBe('rafting')
    expect(url.searchParams.has('groupSize')).toBe(false)
  })

  test('input, submit, and stepper buttons meet the 44px tap-target floor (ADR-0018 §8.2)', async ({
    page,
  }) => {
    await page.goto('/')
    const form = page.getByTestId('home-hero-search')

    for (const locator of [
      form.getByRole('searchbox'),
      form.getByRole('button', { name: 'Search' }),
      form.getByRole('button', { name: /−$/ }),
      form.getByRole('button', { name: /\+$/ }),
    ]) {
      const box = await locator.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
  })

  test('no horizontal scroll with the hero search mounted', async ({ page }) => {
    await page.goto('/')
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    )
    expect(overflow).toBe(false)
  })
})
