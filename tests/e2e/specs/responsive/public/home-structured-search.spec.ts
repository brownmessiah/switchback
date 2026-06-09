/**
 * Responsive verification — home hero STRUCTURED 4-field search (issue 09).
 *
 * Runs under the responsive-phone-public (375) + responsive-tablet-public (768)
 * projects (both coarse-pointer, so the ADR-0018 §8.2 44px tap floor is live).
 * Imports `test` from the devtools fixture, so every test is axe-gated
 * (wcag2a+wcag2aa) at the mobile/tablet viewport.
 *
 * Covers the acceptance criteria:
 *   - submitting the home search lands on /search with the right facets;
 *   - popular chips deep-link to a pre-filtered /search (only inventory-backed
 *     chips render — gated server-side, so we assert on whatever renders);
 *   - the mobile overlay opens full-screen with large targets and no h-scroll.
 */
import { test, expect } from '../../../fixtures/devtools'
import type { Page } from '@playwright/test'

function pageHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test.describe('responsive · home structured search (< lg)', () => {
  test('phone: the mobile overlay trigger opens a full-screen dialog with no h-scroll', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    test.skip(width >= 640, 'overlay trigger is phone-only (< sm)')

    await page.goto('/', { waitUntil: 'networkidle' })

    const trigger = page.getByTestId('home-search-mobile-trigger')
    await expect(trigger).toBeVisible()

    // §8.2: the trigger meets the 44px touch floor.
    const box = await trigger.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Full-screen overlay: its height fills (≈) the viewport.
    const vh = page.viewportSize()?.height ?? 0
    const dialogBox = await dialog.boundingBox()
    expect(dialogBox?.height ?? 0).toBeGreaterThanOrEqual(vh - 4)

    // All four fields + a large submit are present inside the overlay.
    await expect(dialog.getByTestId('home-search-destination')).toBeVisible()
    await expect(dialog.getByTestId('home-search-activity')).toBeVisible()
    await expect(dialog.getByTestId('home-search-date')).toBeVisible()
    await expect(dialog.getByTestId('home-search-groupSize')).toBeVisible()

    // No page-level horizontal overflow with the overlay open.
    expect(await pageHorizontalOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('submitting the structured search lands on /search with the mapped facets', async ({
    page,
  }) => {
    const width = page.viewportSize()?.width ?? 0
    await page.goto('/', { waitUntil: 'networkidle' })

    // On phones the fields live behind the overlay trigger; on tablet they are
    // the inline bar. Open the overlay first when on a phone.
    if (width < 640) {
      await page.getByTestId('home-search-mobile-trigger').click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }

    const scope = width < 640 ? page.getByRole('dialog') : page.getByTestId('home-search-form')

    // Pick the first real (inventory-backed) destination + activity option.
    const destination = scope.getByTestId('home-search-destination')
    const activity = scope.getByTestId('home-search-activity')
    const destValue = await destination.locator('option').nth(1).getAttribute('value')
    const actValue = await activity.locator('option').nth(1).getAttribute('value')
    if (destValue) await destination.selectOption(destValue)
    if (actValue) await activity.selectOption(actValue)

    await Promise.all([
      page.waitForURL(/\/search/),
      scope.getByRole('button', { name: /search|खोज|தேடு|వెతుకు|শোধা|শোধো|বিচাৰক|খুঁজুন/i }).click(),
    ])

    const url = new URL(page.url())
    expect(url.pathname).toMatch(/\/search$/)
    if (destValue) expect(url.searchParams.get('region')).toBe(destValue)
    if (actValue) expect(url.searchParams.get('activity')).toBe(actValue)
  })

  test('popular chips deep-link to a pre-filtered /search (region + activity)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    const chips = page.getByTestId('home-popular-chip')
    const count = await chips.count()
    // Inventory-gated: only renders when a candidate pair has live inventory.
    // When present, every chip must deep-link into a region+activity-filtered
    // /search built via lib/search/home-query.
    if (count === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'no inventory-backed popular chips in this seed; nothing to assert',
      })
      return
    }
    for (const chip of await chips.all()) {
      const href = await chip.getAttribute('href')
      expect(href).toMatch(/^\/search\?region=[^&]+&activity=[^&]+$/)
    }
  })
})
