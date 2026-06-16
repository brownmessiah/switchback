/**
 * E2E smoke for the QR check-in scanner (issue #06).
 *
 * Authenticated via `tests/e2e/.auth/vendor-storage.json` (seed user
 * `u_seed_v_business`) — the Owner of their account, who holds `bookings:checkin`
 * via the Owner wildcard and therefore reaches `/vendor/checkin`.
 *
 * Covers:
 *   - The Owner reaches /vendor/checkin and sees the title, the manual
 *     check-in-code input, and the submit button (the localized en copy).
 *   - The "Scan QR" header action on /vendor/bookings navigates to the scanner
 *     (nav wiring + EXCLUDED_PREFIXES — a missing prefix would 404 via the
 *     public /vendor/[slug] storefront).
 *   - Submitting a garbage code surfaces the sanitized "invalid or expired"
 *     result state (the recordCheckIn envelope never leaks booking existence).
 *   - A non-team user (a Customer with no Vendor role) is DENIED the surface.
 *
 * The verify / write / idempotency / state-unchanged / foreign-booking paths are
 * exhaustively covered in checkin-token.test.ts + checkin-core.test.ts; here we
 * assert the DOM contract + gating. Uses the DevTools fixture (console-error /
 * uncaught-exception / network-failure + axe-core a11y scan after each test).
 */

import path from 'node:path'

import { test, expect } from '../../fixtures/devtools'

test.describe('Vendor QR check-in', () => {
  test('renders the title, manual code input, and submit button', async ({ page }) => {
    const response = await page.goto('/vendor/checkin')
    expect(response?.status()).toBe(200)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('Scan check-in')

    // The manual-entry input + submit button (the dependency-light baseline).
    await expect(page.getByLabel('Check-in code')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /Check in guest/i }),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/vendor-checkin.png',
      fullPage: true,
    })
  })

  test('reaches the scanner from the Scan QR action on the Bookings page', async ({
    page,
  }) => {
    await page.goto('/vendor/bookings')
    await expect(page.locator('h1')).toContainText('Bookings')

    // The "Scan QR" header action links to the scanner. Without the
    // /vendor/checkin EXCLUDED_PREFIXES entry this would 404 via the public
    // /vendor/[slug] storefront.
    await page.locator('a[href="/vendor/checkin"]').first().click()
    await page.waitForURL(/\/vendor\/checkin/)
    await expect(page.locator('h1')).toContainText('Scan check-in')
  })

  test('a garbage code shows the sanitized invalid-or-expired result', async ({
    page,
  }) => {
    await page.goto('/vendor/checkin')

    await page.getByLabel('Check-in code').fill('not-a-real-token')
    await page.getByRole('button', { name: /Check in guest/i }).click()

    // Sanitized failure — the same message for a forged/expired/foreign code or
    // a non-existent booking; it never reveals whether a booking exists.
    await expect(
      page.getByText('Invalid or expired code', { exact: true }),
    ).toBeVisible()
    // The "Scan another" reset affordance returns to the entry form.
    await page.getByRole('button', { name: /Scan another/i }).click()
    await expect(page.getByLabel('Check-in code')).toBeVisible()
  })
})

// A Customer (no Vendor profile, no Vendor role) cannot reach /vendor/checkin —
// the (dashboard) layout gate redirects a non-Vendor to onboarding, and the
// page's own `bookings:checkin` gate would notFound() a non-checkin user. Either
// way the scanner surface must NOT render for a non-team user.
test.describe('QR check-in — non-team user is denied', () => {
  const CUSTOMER_STORAGE = path.resolve(__dirname, '../../.auth/customer-storage.json')
  test.use({ storageState: CUSTOMER_STORAGE })

  test('a Customer never sees the check-in scanner', async ({ page }) => {
    await page.goto('/vendor/checkin')

    await expect(
      page.getByRole('heading', { name: 'Scan check-in' }),
    ).toHaveCount(0)
    await expect(page.getByLabel('Check-in code')).toHaveCount(0)
  })
})
