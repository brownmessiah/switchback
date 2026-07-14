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

  test('date selection carries to /search and narrows to bookable-day results (ADR-0020)', async ({
    page,
  }) => {
    // UTC day key, matching dateKey()/the grid buttons' aria-labels.
    const dayKeyOffset = (days: number): string =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

    // A day the seeds materialize slots for (fixed offsets 5/7/12 PLUS the
    // 90-day weekly-pattern materialization) — deterministically bookable.
    const bookableDay = dayKeyOffset(5)
    await page.goto('/')
    await page.getByTestId('date-popover-trigger').click()
    await page.locator(`[data-day="${bookableDay}"]`).click()
    const form = page.getByTestId('home-hero-search')
    await form.getByRole('button', { name: 'Search' }).click()
    await page.waitForURL(`**/search?**date=${bookableDay}**`)

    const results = page.getByRole('region', { name: 'Search results' })
    const cards = results.locator('a[href^="/experience/"]')
    await expect(cards.first()).toBeVisible()

    // The applied date is VISIBLE and removable as a filter chip (review
    // fix — it would otherwise silently stick across later refinements).
    const chip = page.getByTestId('active-filter-chip-date')
    await expect(chip).toBeVisible()

    // ADR-0020 robots rule: a date-filtered URL is noindex,follow and
    // canonicalises to the bare /search.
    const robots = page.locator('meta[name="robots"]')
    await expect(robots.first()).toHaveAttribute('content', /noindex/i)
    const canonical = page.locator('link[rel="canonical"]')
    await expect(canonical.first()).toHaveAttribute('href', /\/search$/)

    // Dismissing the chip drops ONLY the date param.
    await Promise.all([page.waitForURL((u) => !u.searchParams.has('date')), chip.click()])
    await expect(page.getByTestId('active-filter-chip-date')).toHaveCount(0)
  })

  test('the date popover is keyboard-operable (AC1): open, pick, submit', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByTestId('date-popover-trigger').focus()
    await page.keyboard.press('Enter') // opens the popover
    const popup = page.getByTestId('date-popover')
    await expect(popup).toBeVisible()
    // Keyboard-activate the "Today" pill (Enter).
    const today = popup.getByRole('button', { name: 'Today' })
    await today.focus()
    await page.keyboard.press('Enter')
    await expect(popup).toBeHidden()

    const form = page.getByTestId('home-hero-search')
    await form.getByRole('button', { name: 'Search' }).focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/search\?.*date=\d{4}-\d{2}-\d{2}/)
  })

  test('a date beyond the slot-materialization horizon returns the empty state (ADR-0020 caveat)', async ({
    page,
  }) => {
    const dayKeyOffset = (days: number): string =>
      new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)
    // +100 days: beyond the ~90-day weekly-pattern materialization window
    // (the popover's 2-month grid can't reach it — the BACKEND contract is
    // under test), inside parseDateParam's 366-day clamp. The filter must
    // return the empty state, never fall back to unfiltered.
    const horizonDay = dayKeyOffset(100)

    await page.goto(`/search?date=${horizonDay}`)

    // The results region must have RENDERED (a broken page would also have
    // zero cards) — assert the empty state, then the zero count.
    await expect(page.getByTestId('search-empty')).toBeVisible()
    const results = page.getByRole('region', { name: 'Search results' })
    await expect(results.locator('a[href^="/experience/"]')).toHaveCount(0)
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
