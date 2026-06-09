/**
 * E2E spot-checks for the empty / error / 404 consistency sweep (issue 25).
 *
 * Two unauthenticated flows the issue calls out explicitly:
 *   1. An empty search (a query guaranteed to return zero Experiences) renders
 *      the shared EmptyState with a "Clear filters" action and inventory-backed
 *      popular alternatives — never a blank dashed box.
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
  test('a no-results query shows the EmptyState + Clear filters + popular alternatives', async ({
    page,
  }) => {
    // A nonsense token that cannot match any seeded Experience → zero hits.
    const status = await gotoWarm(page, '/search?q=zzqqxxnoresultszzqqxx')
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
