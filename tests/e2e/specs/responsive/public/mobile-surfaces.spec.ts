/**
 * Responsive verification — PUBLIC surfaces below lg (ADR-0018 §8.6 / DESIGN.md
 * §8). Runs under the responsive-phone-public (375) + responsive-tablet-public
 * (768) projects, both coarse-pointer (hasTouch) so the §8.2 44px floor is live.
 * Imports `test` from the devtools fixture, so every test is axe-gated
 * (wcag2a+wcag2aa) at the mobile/tablet viewport.
 */
import { test, expect } from '../../../fixtures/devtools'
import type { Page } from '@playwright/test'

// A seeded, bookable structured Experience (also used by the screenshot audit).
const EXPERIENCE_SLUG = 'andaman-camping-radhanagar-eco'

function pageHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test.describe('responsive · public surfaces (< lg)', () => {
  test('home + search have no page-level horizontal overflow', async ({ page }) => {
    for (const url of ['/', '/search']) {
      await page.goto(url, { waitUntil: 'networkidle' })
      expect(
        await pageHorizontalOverflow(page),
        `horizontal overflow on ${url}`,
      ).toBeLessThanOrEqual(2)
    }
  })

  test('search: the desktop filter rail is hidden and the Filters Sheet opens the facets', async ({
    page,
  }) => {
    await page.goto('/search', { waitUntil: 'networkidle' })
    // B1 / §8.3: the rail is `hidden lg:block`; the Sheet trigger drives filters < lg.
    await expect(page.getByTestId('search-filter-rail')).toBeHidden()
    const trigger = page.getByTestId('search-filters-trigger')
    await expect(trigger).toBeVisible()
    await trigger.click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('PDP: the desktop booking rail hides below lg and a sticky bottom bar takes over', async ({
    page,
  }) => {
    await page.goto(`/experience/${EXPERIENCE_SLUG}`, { waitUntil: 'networkidle' })
    // §8.4 lg-only side-rail exception: the ~22rem desktop side-rail is `hidden lg:block`...
    await expect(page.locator('#booking')).toBeHidden()
    // ...and below lg the sticky bottom bar is the booking entry point.
    const bar = page.getByTestId('booking-rail-mobile-trigger')
    await expect(bar).toBeVisible()
    // When the Experience is bookable the bar opens a bottom Sheet; an active
    // Region closure (ADR-0011) renders it as a disabled "Currently closed" control.
    if (await bar.isEnabled()) {
      await bar.click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }
    expect(
      await pageHorizontalOverflow(page),
      'horizontal overflow on the PDP',
    ).toBeLessThanOrEqual(2)
  })
})
