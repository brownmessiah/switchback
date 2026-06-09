/**
 * E2E — global toast system (issue 24, DECISION D11: sonner).
 *
 * Covers the two acceptance-criteria flows on the public (unauthenticated)
 * surface:
 *
 *   1. Login-required toast — a logged-out visitor clicking the Wishlist heart
 *      on a PDP gets an accessible info toast ("Sign in to save …", role=status)
 *      before being routed to /sign-in. (The "wishlist add → toast" path for a
 *      signed-in customer is exercised by tests/e2e/specs/customer/toast.spec.ts;
 *      logged out, the SAME heart fires the login-gated toast instead.)
 *
 *   2. Simulated Availability error → error toast (role=alert). The PDP exposes
 *      a non-production test seam `?simulateAvailabilityError=1` that flips the
 *      booking-rail availability-error toast, so we can assert the assertive
 *      error variant without injecting a real DB fault.
 *
 * The Toaster is mounted ONCE in the root layout, so it is present on every
 * surface; sonner renders normal/info toasts with role=status and errors with
 * role=alert, and every toast carries a dismiss (close) button.
 */

import { test, expect } from '../../fixtures/devtools'

const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'

test.describe('Toast system (public surface)', () => {
  test('login-required toast fires on the wishlist heart for a logged-out visitor', async ({
    page,
  }) => {
    await page.goto(`/experience/${RAFTING_SLUG}`)
    await expect(page.locator('h1')).toBeVisible()

    const heart = page.getByTestId('wishlist-button').first()
    await expect(heart).toBeVisible()
    await heart.click()

    // Accessible, polite info toast (role=status) — sonner announces it and
    // gives it a dismiss button.
    const toast = page.getByRole('status').filter({ hasText: /sign in/i }).first()
    await expect(toast).toBeVisible()
  })

  test('simulated availability error surfaces an assertive error toast (role=alert)', async ({
    page,
  }) => {
    await page.goto(`/experience/${RAFTING_SLUG}?simulateAvailabilityError=1`)
    await expect(page.locator('h1')).toBeVisible()

    // sonner gives error toasts role=alert (assertive) so screen readers
    // interrupt — the right urgency for a load failure.
    const errorToast = page
      .getByRole('alert')
      .filter({ hasText: /couldn.t load availability|availability/i })
      .first()
    await expect(errorToast).toBeVisible()

    // Dismissible: a close control is present on the toast (ADR-0018 a11y).
    const closeButton = page.locator('[data-sonner-toast] button[data-close-button]').first()
    await expect(closeButton).toBeVisible()
  })
})
