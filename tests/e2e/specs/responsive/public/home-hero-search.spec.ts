/**
 * Responsive verification — the single hero search (owner screenshots,
 * 2026-06-11; supersedes the issue-09 4-field module spec). Runs under
 * responsive-phone-public (375) + responsive-tablet-public (768). The one
 * "Destination or activity" field GET-posts to /search?q= with zero JS and
 * meets the §8.2 44px coarse-pointer floor.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) gating per test.
 */

import { test, expect } from '../../../fixtures/devtools'

test.describe('home hero search · single field', () => {
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

  test('input and submit meet the 44px tap-target floor (ADR-0018 §8.2)', async ({
    page,
  }) => {
    await page.goto('/')
    const form = page.getByTestId('home-hero-search')

    for (const locator of [
      form.getByRole('searchbox'),
      form.getByRole('button'),
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
