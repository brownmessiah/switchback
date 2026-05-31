/**
 * E2E tests for the static trust/info pages: /safety and /about.
 *
 * /safety carries the real trust story grounded in the domain model:
 *   - three-tier KYC verification ladder (ADR-0007)
 *   - cancellation/refund presets + two-bucket wallet refunds (ADR-0005)
 *   - partial-pay Advance + T-24h auto-capture
 *   - required permits + the safety stack (ADR-0011 / ADR-0015)
 *
 * /about is a straightforward, honest company/mission page.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import { test, expect } from '../../fixtures/devtools'

// ---------------------------------------------------------------------------
// 1. Safety page
// ---------------------------------------------------------------------------
test.describe('Safety page', () => {
  test('renders 200, H1, and the real trust sections', async ({ page }) => {
    const response = await page.goto('/safety')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Outvers/)

    // H1 present
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Breadcrumb nav present
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // The three-tier KYC verification ladder (ADR-0007) — each badge name is
    // load-bearing CONTEXT.md vocabulary.
    await expect(page.getByText('Phone verified', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Identity verified', { exact: false }).first()).toBeVisible()
    await expect(page.getByText('Business verified', { exact: false }).first()).toBeVisible()

    // Cancellation/refund + wallet (ADR-0005) — the section mentions the
    // presets and the cancellation policy with a working link to the policy page.
    await expect(page.getByText(/cancellation/i).first()).toBeVisible()
    await expect(page.getByText(/refund/i).first()).toBeVisible()
    await expect(
      page.locator('a[href="/cancellation-policy"]').first(),
    ).toBeVisible()

    // Partial pay — Advance + T-24h auto-capture.
    await expect(page.getByText(/Advance/i).first()).toBeVisible()

    // Permits + safety stack (ADR-0011 / ADR-0015): trusted contact + SOS +
    // check-in are named; the honest "notification, not response" posture.
    await expect(page.getByText(/permit/i).first()).toBeVisible()
    await expect(page.getByText(/trusted contact/i).first()).toBeVisible()
    await expect(page.getByText(/SOS/).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/safety.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. About page
// ---------------------------------------------------------------------------
test.describe('About page', () => {
  test('renders 200 and H1', async ({ page }) => {
    const response = await page.goto('/about')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveTitle(/Outvers/)

    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()

    // Breadcrumb nav present
    await expect(page.locator('nav[aria-label="Breadcrumb"]')).toBeVisible()

    // Honest framing: India adventure marketplace + KYC-verified vendors.
    await expect(page.getByText(/marketplace/i).first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/about.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Footer links resolve to the new routes
// ---------------------------------------------------------------------------
test.describe('Trust-page footer links', () => {
  test('Safety + About links in the footer resolve to 200', async ({
    page,
  }) => {
    await page.goto('/')

    const safetyLink = page.locator('footer a[href="/safety"]')
    await expect(safetyLink).toBeVisible()
    const aboutLink = page.locator('footer a[href="/about"]')
    await expect(aboutLink).toBeVisible()

    const safetyResponse = await page.goto('/safety')
    expect(safetyResponse?.status()).toBe(200)

    const aboutResponse = await page.goto('/about')
    expect(aboutResponse?.status()).toBe(200)
  })
})
