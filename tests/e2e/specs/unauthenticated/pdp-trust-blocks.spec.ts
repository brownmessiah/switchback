/**
 * E2E — PDP trust/clarity blocks (issue 13).
 *
 * Three blocks added to the Experience detail page WITHOUT reordering the
 * overhauled "Airbnb-style" PDP (DECISION D11):
 *
 *   1. Third-party Vendor disclosure near the booking box.
 *   2. "What happens after booking?" — the 5-step journey, server-rendered
 *      (crawlable) as an ordered list.
 *   3. Price transparency — the booking box shows the Advance + balance + a
 *      refundable/cancellation pointer for a partial-pay Experience.
 *
 * Asserted on the seeded camping Experience (flexible preset, ≥48h slots under
 * the demo catalog). Uses the DevTools fixture for console-error + axe-core
 * checks after each test (axe clean is an acceptance criterion).
 */

import { test, expect } from '../../fixtures/devtools'

const PDP = '/experience/bir-billing-camping-mountain-stay'

test.describe('PDP trust/clarity blocks (issue 13)', () => {
  test('the third-party Vendor disclosure renders, using "Vendor" never "operator"', async ({
    page,
  }) => {
    const response = await page.goto(PDP)
    expect(response?.status()).toBe(200)

    const disclosure = page.locator('[data-slot="vendor-disclosure"]')
    await expect(disclosure).toBeVisible()
    // The disclosure noun is Vendor; the word "operator" never appears.
    await expect(disclosure).toContainText('third-party Vendors')
    await expect(page.getByText('operator', { exact: false })).toHaveCount(0)
  })

  test('"What happens after booking?" renders as a crawlable ordered list of 5 steps', async ({
    page,
  }) => {
    await page.goto(PDP)

    const section = page.locator('#afterBooking')
    await expect(section).toBeVisible()
    await expect(
      section.getByRole('heading', { name: /what happens after booking/i }),
    ).toBeVisible()

    // Server-rendered <ol> with exactly 5 ordered steps (crawlable, no JS).
    const steps = section.locator('[data-testid="after-booking-step"]')
    await expect(steps).toHaveCount(5)
    // Load-bearing vocabulary surfaces in the journey copy.
    await expect(section).toContainText('Advance')
    await expect(section).toContainText('Partial pay')
    await expect(section).toContainText('instantly')
  })

  // The decision-complete booking Card is the `lg`-only desktop side-rail
  // (`#booking` is `hidden lg:block`, ADR-0018 / DESIGN.md §8.4); the mobile /
  // tablet tier is served by a bottom-bar → Sheet. Pin a desktop viewport so
  // the side-rail breakdown is visible.
  test.describe('desktop booking side-rail', () => {
    test.use({ viewport: { width: 1280, height: 900 } })

    test('the booking box shows Advance, balance, and a refundable/cancellation pointer', async ({
      page,
    }) => {
      await page.goto(PDP)

      // The desktop sticky side-rail carries the live breakdown.
      const rail = page.locator('#booking')
      await expect(rail).toBeVisible()

      // Advance (25%) + balance (T-24h) split is shown for the partial-pay listing.
      await expect(rail.getByText(/Advance due now/i)).toBeVisible()
      await expect(rail.getByText(/Balance at T-24h/i)).toBeVisible()
      // Refundable amount points to the cancellation policy (no fabricated number,
      // and never "Free cancellation" vocabulary drift).
      await expect(rail.getByText(/cancellation policy/i).first()).toBeVisible()
    })
  })
})
