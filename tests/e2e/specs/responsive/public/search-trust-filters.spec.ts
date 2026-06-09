/**
 * Responsive verification — trust-oriented search filters via the mobile filter
 * Sheet (issue 10).
 *
 * Runs under the responsive-phone-public (375) + responsive-tablet-public (768)
 * projects (both coarse-pointer, so the ADR-0018 §8.2 44px tap floor is live)
 * and is axe-gated via the devtools fixture. On < lg the desktop rail collapses
 * behind the labelled "Filters" trigger; opening the Sheet reveals the SAME
 * facet controls. Applying the Flexible filter from inside the Sheet renders a
 * removable active-filter chip on the page; dismissing it drops only that param.
 */

import { test, expect } from '../../../fixtures/devtools'

test.describe('responsive · search trust filters (mobile Sheet)', () => {
  test('apply Flexible cancellation in the Sheet → chip appears → remove → results update', async ({
    page,
  }) => {
    await page.goto('/search', { waitUntil: 'networkidle' })

    // The mobile Filters trigger opens the Sheet with the same facet controls.
    const trigger = page.getByTestId('search-filters-trigger')
    await expect(trigger).toBeVisible()
    await trigger.click()

    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()

    // Apply the Flexible-cancellation filter from inside the Sheet.
    await Promise.all([
      page.waitForURL(/cancellation=flexible/),
      sheet.getByTestId('facet-flexible').click(),
    ])
    expect(new URL(page.url()).searchParams.get('cancellation')).toBe('flexible')

    // The removable chip is rendered on the page (the Sheet may auto-close on
    // navigation; the chip row lives in the results section either way).
    const flexChip = page.getByTestId('active-filter-chip-cancellation')
    await expect(flexChip).toBeVisible()

    // §8.2 — the chip's tap target meets the 44px coarse-pointer floor.
    const box = await flexChip.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)

    // Removing the chip drops only that param.
    await Promise.all([
      page.waitForURL((url) => !url.search.includes('cancellation=flexible')),
      flexChip.click(),
    ])
    expect(new URL(page.url()).searchParams.has('cancellation')).toBe(false)
    await expect(page.getByTestId('active-filter-chip-cancellation')).toHaveCount(0)
  })
})
