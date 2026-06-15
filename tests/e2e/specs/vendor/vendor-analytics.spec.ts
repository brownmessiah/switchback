/**
 * E2E smoke for the Vendor Analytics surface (issue 01 — tracer bullet).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`, business-verified, with seeded Bookings).
 *
 * Covers:
 *   - An authenticated Vendor reaches /vendor/analytics and sees the Analytics
 *     heading plus the Total revenue / Total bookings headline KPIs.
 *   - The "Analytics" sidebar item navigates to the route (nav wiring).
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

test.describe('Vendor analytics', () => {
  test('renders the Analytics heading and headline KPIs', async ({ page }) => {
    const response = await page.goto('/vendor/analytics')
    expect(response?.status()).toBe(200)

    // Page heading.
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Analytics')

    // Headline KPI labels (en canonical copy).
    await expect(page.getByText('Total revenue', { exact: true })).toBeVisible()
    await expect(page.getByText('Total bookings', { exact: true })).toBeVisible()

    // The seed business Vendor has Bookings → at least one rupee figure renders.
    await expect(page.getByText(/₹[\d,]+/).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-analytics.png',
      fullPage: true,
    })
  })

  test('reaches Analytics from the sidebar nav item', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await expect(page.locator('h1')).toContainText('Dashboard')

    // The sidebar renders one Analytics link to the route. Click the first.
    await page.locator('a[href="/vendor/analytics"]').first().click()
    await page.waitForURL(/\/vendor\/analytics/)
    await expect(page.locator('h1')).toContainText('Analytics')
  })
})
