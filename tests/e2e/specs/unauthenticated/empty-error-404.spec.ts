/**
 * E2E spot-checks for the empty / error / 404 consistency sweep (issue 25).
 *
 * Two unauthenticated flows the issue calls out explicitly:
 *   1. An empty search renders the shared EmptyState with inventory-backed
 *      popular alternatives — never a blank dashed box. The "Clear filters"
 *      action is FILTER-specific (ADR-0013 `isFilteredSearch`): it renders only
 *      for a genuinely filtered zero-result search, NOT for a query-only one
 *      (where `isFilteredSearch` deliberately excludes `q`). Both paths are
 *      asserted below to pin the certified `SearchEmptyState` contract.
 *   2. A non-existent route renders the premium 404 with BOTH CTAs:
 *      "Explore Experiences" (→ /search) and "Go Home" (→ /).
 *
 * The DevTools fixture additionally gates console errors, uncaught exceptions,
 * 5xx responses, and runs axe-core after every test.
 */

import { test, expect } from '../../fixtures/devtools'
import type { Page } from '@playwright/test'

async function gotoWarm(page: Page, path: string): Promise<number | undefined> {
  let response = await page.goto(path)
  if (response?.status() === 500) {
    await page.waitForTimeout(1500)
    response = await page.goto(path)
  }
  return response?.status()
}

test.describe('Empty search renders the polished EmptyState', () => {
  test('a filtered no-results search shows the EmptyState + Clear filters + popular alternatives', async ({
    page,
  }) => {
    // A genuinely FILTERED zero-result search. `isFilteredSearch` deliberately
    // excludes `q` (lib/search/search-experiences.ts:148-170 — the ADR-0013
    // narrowing set is region/activity/price/facets, NOT the free-text query),
    // so the "Clear filters" CTA only renders for a real filter. region=goa +
    // activity=scuba-diving are seeded slugs, and minPrice=99999999 (₹) is an
    // impossible price floor → `buildMeiliFilter` emits a valid 3-clause filter
    // that matches zero docs. So `isFiltered=true` AND `hits.length === 0`.
    const status = await gotoWarm(
      page,
      '/search?region=goa&activity=scuba-diving&minPrice=99999999',
    )
    expect(status).toBeLessThan(400)

    const empty = page.getByTestId('search-empty')
    await expect(empty).toBeVisible()

    // A clear next action: "Clear filters" links back to the bare /search.
    const clear = empty.getByRole('link', { name: /clear filters/i })
    await expect(clear).toBeVisible()
    await expect(clear).toHaveAttribute('href', '/search')

    // Inventory-backed popular alternatives — each is a real, pre-filtered
    // /search deep link (D0). The seed always has live inventory, so at least
    // one alternative renders.
    const alternatives = empty.getByTestId('search-empty-alternative')
    await expect(alternatives.first()).toBeVisible()
    for (const href of await alternatives.evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? ''),
    )) {
      expect(href.startsWith('/search?')).toBe(true)
    }

    // Clicking "Clear filters" returns to the bare (unfiltered) search.
    await clear.click()
    await expect(page).toHaveURL(/\/search$/)
  })

  test('a query-only no-results search shows the EmptyState + alternatives but NO Clear filters', async ({
    page,
  }) => {
    // A nonsense token that cannot match any seeded Experience → zero hits, but
    // a QUERY-ONLY search. Per ADR-0013, `isFilteredSearch({ q })` is FALSE
    // (search-experiences.ts:148 excludes `q`; unit-asserted at
    // search-experiences.test.ts:200), so `search/page.tsx:134` passes
    // `isFiltered={false}` and `SearchEmptyState` renders NO Clear-filters CTA
    // (component contract: search-empty-state.tsx:68; unit-asserted at the
    // "does NOT render a Clear filters link" case). The EmptyState shell and the
    // inventory-backed alternatives still render — the page is never a blank box.
    const status = await gotoWarm(page, '/search?q=zzqqxxnoresultszzqqxx')
    expect(status).toBeLessThan(400)

    const empty = page.getByTestId('search-empty')
    await expect(empty).toBeVisible()

    // The Clear-filters CTA is filter-specific and MUST be absent here.
    await expect(empty.getByRole('link', { name: /clear filters/i })).toHaveCount(0)

    // The inventory-backed popular alternatives still render (live seed inventory).
    const alternatives = empty.getByTestId('search-empty-alternative')
    await expect(alternatives.first()).toBeVisible()
  })
})

test.describe('Premium 404 renders both CTAs', () => {
  test('a non-existent route shows premium copy + Explore Experiences + Go Home', async ({
    page,
  }) => {
    const response = await page.goto('/this-route-does-not-exist-zzqqxx')
    // Next renders the not-found page with a 404 status.
    expect(response?.status()).toBe(404)

    const explore = page.getByRole('link', { name: 'Explore Experiences' })
    const home = page.getByRole('link', { name: 'Go Home' })
    await expect(explore).toBeVisible()
    await expect(home).toBeVisible()
    await expect(explore).toHaveAttribute('href', '/search')
    await expect(home).toHaveAttribute('href', '/')

    // The CTAs actually navigate.
    await explore.click()
    await expect(page).toHaveURL(/\/search$/)
  })
})
