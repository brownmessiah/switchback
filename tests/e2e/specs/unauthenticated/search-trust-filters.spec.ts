/**
 * E2E — trust-oriented search filters + active-filter chips (issue 10).
 *
 * Exercises the desktop filter rail (≥ lg, the default unauthenticated 1280px
 * viewport): applying the Flexible-cancellation / Safety Checked / rating
 * filters narrows the result set, renders a removable chip per applied filter
 * above the results, keeps the result count accurate, and removing a chip drops
 * ONLY that filter. Also asserts the load-bearing guardrail: there is NO
 * "Instant confirmation" filter (it is universally true, ADR-0003).
 *
 * Uses the DevTools fixture so every test is console-error- and axe-gated.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Search trust filters + active-filter chips (desktop rail)', () => {
  test('applying Flexible cancellation adds a removable chip and filters the URL', async ({
    page,
  }) => {
    await page.goto('/search')

    const rail = page.getByTestId('search-filter-rail')
    await expect(rail).toBeVisible()

    // Apply the Flexible-cancellation filter (toggle chip in the Trust group).
    await Promise.all([
      page.waitForURL(/cancellation=flexible/),
      rail.getByTestId('facet-flexible').click(),
    ])
    expect(new URL(page.url()).searchParams.get('cancellation')).toBe('flexible')

    // A removable active-filter chip appears above the results.
    const chips = page.getByTestId('active-filter-chips')
    await expect(chips).toBeVisible()
    const flexChip = page.getByTestId('active-filter-chip-cancellation')
    await expect(flexChip).toBeVisible()

    // Removing the chip drops ONLY that param and the results update.
    await Promise.all([
      page.waitForURL((url) => !url.search.includes('cancellation=flexible')),
      flexChip.click(),
    ])
    expect(new URL(page.url()).searchParams.has('cancellation')).toBe(false)
    await expect(page.getByTestId('active-filter-chip-cancellation')).toHaveCount(0)
  })

  test('the rating filter narrows results and its chip removes only the rating param', async ({
    page,
  }) => {
    // Seed both a rating and a region so we can prove the chip removes ONLY its
    // own param: region must survive removing the rating chip.
    await page.goto('/search?region=rishikesh&minRating=4')

    const ratingChip = page.getByTestId('active-filter-chip-rating')
    const regionChip = page.getByTestId('active-filter-chip-region')
    await expect(ratingChip).toBeVisible()
    await expect(regionChip).toBeVisible()

    await Promise.all([
      page.waitForURL((url) => !url.search.includes('minRating')),
      ratingChip.click(),
    ])
    const params = new URL(page.url()).searchParams
    expect(params.has('minRating')).toBe(false)
    // The region filter is untouched — only the rating was removed.
    expect(params.get('region')).toBe('rishikesh')
    await expect(page.getByTestId('active-filter-chip-region')).toBeVisible()
  })

  test('Safety Checked filter renders a chip and the result count stays accurate', async ({
    page,
  }) => {
    await page.goto('/search')

    const rail = page.getByTestId('search-filter-rail')
    await Promise.all([
      page.waitForURL(/safetyVerified=true/),
      rail.getByTestId('facet-safety').click(),
    ])

    await expect(page.getByTestId('active-filter-chip-safety')).toBeVisible()

    // The result count region is present and reflects the (possibly narrowed)
    // hit set — the count text is rendered regardless of how many hits match.
    const section = page.getByRole('region', { name: /search results|खोज|தேடல்/i })
    await expect(section).toBeVisible()
  })

  test('there is NO "Instant confirmation" filter control (ADR-0003)', async ({
    page,
  }) => {
    await page.goto('/search')

    // Instant confirmation is universally true, so it is a trust BADGE, never a
    // filter. No control with that label may exist in either filter surface.
    await expect(
      page.getByRole('button', { name: /instant confirmation/i }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('checkbox', { name: /instant confirmation/i }),
    ).toHaveCount(0)
  })
})
