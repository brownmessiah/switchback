/**
 * E2E smoke for the Vendor dashboard quick-action cards (issue 04).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`, business-verified).
 *
 * Covers:
 *   - The dashboard home renders the four quick-action wayfinding cards.
 *   - Each card navigates to its real existing Vendor surface:
 *       Add Experience      → /vendor/listings/new
 *       View Bookings       → /vendor/bookings
 *       Manage Availability → /vendor/listings   (Experiences list; availability
 *                                                 is per-Experience, no top-level
 *                                                 /vendor/availability route)
 *       View Earnings       → /vendor/payouts
 *
 * The DevTools fixture runs a console-error / uncaught-exception / network-failure
 * check AND an axe-core accessibility scan after each test (axe clean on the home).
 */

import { test, expect } from '../../fixtures/devtools'

const QUICK_ACTION_HREFS = [
  '/vendor/listings/new',
  '/vendor/bookings',
  '/vendor/listings',
  '/vendor/payouts',
] as const

test.describe('Vendor dashboard quick actions', () => {
  test('renders the four quick-action cards on the dashboard home', async ({ page }) => {
    const response = await page.goto('/vendor/dashboard')
    expect(response?.status()).toBe(200)
    await expect(page.locator('h1')).toContainText('Dashboard')

    // The quick-action section is labelled by its heading.
    const section = page.getByRole('region', { name: 'Quick actions' })
    await expect(section).toBeVisible()

    for (const href of QUICK_ACTION_HREFS) {
      await expect(section.locator(`a[href="${href}"]`)).toBeVisible()
    }

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-quick-actions.png',
      fullPage: true,
    })
  })

  test('Add Experience card routes to the listing-create surface', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: /Add Experience/i }).click()
    await page.waitForURL(/\/vendor\/listings\/new/)
  })

  test('View Bookings card routes to the Bookings surface', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: /View Bookings/i }).click()
    await page.waitForURL(/\/vendor\/bookings/)
  })

  test('Manage Availability card routes to the Experiences list (not /vendor/availability)', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: /Manage Availability/i }).click()
    await page.waitForURL(/\/vendor\/listings(?!\/new)/)
    expect(page.url()).not.toContain('/vendor/availability')
  })

  test('View Earnings card routes to the Payouts surface', async ({ page }) => {
    await page.goto('/vendor/dashboard')
    await page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: /View Earnings/i }).click()
    await page.waitForURL(/\/vendor\/payouts/)
  })
})
