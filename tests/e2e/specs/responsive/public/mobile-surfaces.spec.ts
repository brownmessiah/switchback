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

  test('home trust + how-it-works sections render with no horizontal overflow (issue 08)', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })

    // Both new sections are present at the mobile/tablet viewport (they wrap /
    // stack rather than scroll horizontally).
    await expect(
      page.getByRole('region', { name: 'Adventure you can trust' }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'How Outvers works' }),
    ).toBeVisible()

    // No page-level horizontal overflow (re-asserted after the sections render).
    expect(await pageHorizontalOverflow(page)).toBeLessThanOrEqual(2)
  })

  test('home activity chips: no h-scroll strip; +N more only on phones', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const more = page.getByTestId('activities-more')
    const width = page.viewportSize()?.width ?? 0
    if (width < 768) {
      // phone: when the seed exceeds the cap, +N more is visible and points at /search
      if (await more.count()) {
        await expect(more.first()).toBeVisible()
        await expect(more.first()).toHaveAttribute('href', /\/search/)
      }
    } else {
      // tablet/desktop: the +N more affordance is not shown (all chips render)
      await expect(more).toBeHidden()
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

  test('footer newsletter: fill email at phone width → submit → success state', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const form = page.getByTestId('newsletter-form')
    await form.scrollIntoViewIfNeeded()
    await page.getByTestId('newsletter-email').fill('e2e-subscriber@example.com')
    await page.getByTestId('newsletter-submit').click()
    await expect(page.getByTestId('newsletter-success')).toBeVisible()
  })

  test('footer: Contact block links to /contact and exposes the support email', async ({
    page,
  }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    const footer = page.locator('footer')
    await footer.scrollIntoViewIfNeeded()
    // Contact us → /contact. The footer legitimately renders two such links
    // (Support column + the new Contact block), so assert at least one exists
    // and that every one points at /contact (tolerant of the duplicate).
    const contactLinks = footer.getByRole('link', { name: /contact us/i })
    expect(await contactLinks.count()).toBeGreaterThan(0)
    for (const link of await contactLinks.all()) {
      await expect(link).toHaveAttribute('href', /\/contact/)
    }
    // support@outvers.com mailto present
    await expect(footer.locator('a[href="mailto:support@outvers.com"]')).toBeVisible()
    // 4 social links rendered (placeholder #) — aria-labels carry the network name
    await expect(footer.getByRole('link', { name: /Instagram/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /YouTube/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /Facebook/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /on X$/i })).toBeVisible()
  })
})
