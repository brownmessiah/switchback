/**
 * E2E — customer cart foundation (home-redesign issue 11, ADR-0021).
 *
 * The cart is a saved list: PDP "Add to cart" → header badge → /cart page
 * (list, per-line participants edit, remove, INR subtotal, INERT checkout —
 * issue 12 wires the money path).
 *
 * Sessions are MINTED VIA THE REAL UI LOGIN (demo credentials seeded by
 * db/seed-demo-passwords.ts) instead of the injected storageState: at the
 * time of writing the customer project's storageState yields an EMPTY
 * cookie jar (pre-existing harness issue — untouched specs like
 * wishlist.spec fail the same way), and the repo gotcha explicitly prefers
 * fresh demo logins over stale .auth sessions anyway.
 *
 * DevTools fixture → axe (wcag2a+wcag2aa) + console-error gating per test.
 */

import type { Page } from '@playwright/test'

import { test, expect } from '../../fixtures/devtools'
import { mockRazorpayCheckout } from '../../helpers/razorpay-mock'

// Seeded flagship rafting Experience with future open slots — see db/seed.ts.
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'
const DEMO_CUSTOMER_EMAIL = 'customer@seed.outvers.dev'
const DEMO_PASSWORD = 'OutversDemo!2026'

async function signInAsDemoCustomer(page: Page): Promise<void> {
  await page.goto('/sign-in')
  await page.locator('input#email[type="email"]').fill(DEMO_CUSTOMER_EMAIL)
  await page.getByTestId('continue-step1').click()
  await page.locator('input#password').fill(DEMO_PASSWORD)
  const form = page
    .locator('form')
    .filter({ has: page.locator('input#email[type="email"]') })
  await form.locator('button[type="submit"]').click()
  await page.waitForURL((u: URL) => !u.pathname.startsWith('/sign-in'))
}

test.describe('customer cart (issue 11)', () => {
  test.beforeEach(async ({ page }) => {
    await signInAsDemoCustomer(page)
  })

  test('add to cart from the PDP → toast + header badge count', async ({ page }) => {
    await page.goto(`/experience/${RAFTING_SLUG}`)

    const addButton = page.getByTestId('add-to-cart').first()
    await expect(addButton).toBeEnabled()
    await addButton.click()
    await expect(page.getByText('Added to your cart').first()).toBeVisible()

    // The badge reflects the count after a navigation (mount-time fetch).
    await page.goto('/')
    const indicator = page.getByTestId('cart-indicator')
    await expect(indicator).toBeVisible()
    await expect(page.getByTestId('cart-indicator-count')).toHaveText(/[1-9]/)
  })

  test('/cart lists the saved line; stepper edits update the subtotal; remove empties', async ({
    page,
  }) => {
    // Ensure at least one line exists (idempotent: same slot merges).
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByText('Added to your cart').first()).toBeVisible()

    await page.goto('/cart')
    const items = page.getByTestId('cart-item')
    await expect(items).toHaveCount(1)
    const subtotalBefore = await page.getByTestId('cart-subtotal').textContent()

    // Step participants up — subtotal must change (bracket math is unit-
    // tested; here we assert the wiring persists + rerenders).
    await page.getByRole('button', { name: 'Participants +' }).first().click()
    await expect
      .poll(async () => page.getByTestId('cart-subtotal').textContent())
      .not.toBe(subtotalBefore)

    // The checkout CTA is gated behind the permits acknowledgement.
    await expect(page.getByTestId('cart-checkout')).toBeDisabled()

    // Reload: the edit persisted server-side.
    await page.reload()
    await expect(page.getByTestId('cart-item')).toHaveCount(1)

    // Remove → empty state.
    await page.getByRole('button', { name: /^Remove / }).click()
    await expect(page.getByTestId('cart-empty')).toBeVisible()

    // Badge follows on next navigation.
    await page.goto('/')
    await expect(page.getByTestId('cart-indicator-count')).toHaveCount(0)
  })

  test('multi-item checkout: pay once, land on bookings, cart emptied (issue 12)', async ({
    page,
  }) => {
    await mockRazorpayCheckout(page)

    // A BUSINESS-tier vendor's experience: the flagship rafting vendor is
    // identity-tier and its ADR-0007 FY tier cap is already consumed by the
    // seeded demo bookings — checkout there correctly rejects with
    // TIER_CAP_EXCEEDED (verified: the all-or-nothing rejection audit
    // fires). Business tier has headroom; Goa is not region-closed in seeds
    // (lonavala/spiti/leh-ladakh/andaman are).
    await page.goto('/experience/goa-kayaking-mandovi-mangrove')
    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByText('Added to your cart').first()).toBeVisible()

    await page.goto('/cart')
    await expect(page.getByTestId('cart-item')).toHaveCount(1)
    await page.getByTestId('cart-permits-ack').check()
    const cta = page.getByTestId('cart-checkout')
    await expect(cta).toBeEnabled()
    await cta.click()

    // The mocked Razorpay sheet auto-succeeds -> UI advances to bookings.
    await page.waitForURL(/\/bookings/)

    // The cart is empty afterwards (cleared inside the checkout tx).
    await page.goto('/cart')
    await expect(page.getByTestId('cart-empty')).toBeVisible()
  })
})
