/**
 * Core Web Vitals benchmark — authenticated CUSTOMER pages.
 *
 * NON-BLOCKING (Issue #111): captures TTFB / FCP / LCP / CLS + navigation
 * timing for the top authenticated customer pages and LOGS them (console +
 * annotations). It adds NO CWV pass/fail thresholds — the only assertions are
 * lenient "the page rendered" checks so the full suite stays green. Dev-mode
 * numbers (unminified, dev server) are a RELATIVE baseline only, not
 * production-representative.
 *
 * Authenticated via tests/e2e/.auth/customer-storage.json (the `customer`
 * Playwright project injects it — seed user `u_seed_customer`).
 *
 * Vitals capture is the SHARED helper in tests/e2e/helpers/web-vitals.ts,
 * reused from the marketing benchmark spec (no duplication).
 *
 * Recorded baseline: .scratch/mvp-validation-redesign/cwv-baseline.md
 *
 * Pages benchmarked:
 *   - /dashboard                         (direct navigation)
 *   - /checkout?experienceId=…           (resolved from a seeded slot — the
 *                                          checkout "Your details" step renders
 *                                          without creating a booking)
 *   - /bookings/{id}/confirmation        (a seeded confirmed booking)
 *
 * Note: the checkout is benchmarked at the cleanly reachable "Your details"
 * step. We deliberately do NOT pay (that would create a Booking / move money),
 * so the post-payment step is out of scope for a non-blocking capture.
 */

import { test } from '../../fixtures/devtools'
import {
  collectWebVitals,
  pushVitalsAnnotations,
  reportVitals,
} from '../../helpers/web-vitals'
import {
  getConfirmedBookingForExperienceSlug,
  getOpenSlotForExperienceSlug,
} from '../../helpers/db-assertions'

// Seeded flagship rafting experience — has an open future slot (db/seed.ts).
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'
// Seeded confirmed booking target — never mutated by these read-only captures.
const CONFIRMED_SLUG = 'bir-billing-paragliding-full-day'

test.describe('Core Web Vitals benchmark — customer (non-blocking)', () => {
  test.describe.configure({ mode: 'serial' })

  test('customer dashboard', async ({ page }, testInfo) => {
    const response = await page.goto('/dashboard', { waitUntil: 'load' })
    test.expect(response?.status()).toBe(200)

    const vitals = await collectWebVitals(page)
    reportVitals('Customer dashboard (/dashboard)', vitals)

    // Lenient render check — the dashboard heading is present.
    await test.expect(page.locator('h1').first()).toBeVisible()

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('checkout (your-details step)', async ({ page }, testInfo) => {
    // Resolve a real experienceId from the seeded rafting slot, then land the
    // checkout review step directly. This renders the checkout WITHOUT paying,
    // so no Booking is created and no money moves.
    const slot = await getOpenSlotForExperienceSlug(RAFTING_SLUG)
    test.expect(slot, 'seeded rafting experience must exist').toBeTruthy()

    const response = await page.goto(
      `/checkout?experienceId=${slot!.experienceId}`,
      { waitUntil: 'load' },
    )
    test.expect(response?.status()).toBe(200)

    const vitals = await collectWebVitals(page)
    reportVitals('Checkout (/checkout — your-details step)', vitals)

    await test.expect(page.locator('h1').first()).toContainText('Checkout')

    pushVitalsAnnotations(testInfo, vitals)
  })

  test('booking confirmation', async ({ page }, testInfo) => {
    // Resolve a seeded CONFIRMED booking deterministically from the DB. This
    // capture is read-only — it never mutates the booking, so it stays
    // confirmed for any parallel workers.
    const booking = await getConfirmedBookingForExperienceSlug(CONFIRMED_SLUG)
    if (!booking) {
      test.skip(true, 'No seeded confirmed booking available to benchmark')
      return
    }

    const response = await page.goto(
      `/bookings/${booking.bookingId}/confirmation`,
      { waitUntil: 'load' },
    )
    test.expect(response?.status()).toBe(200)

    const vitals = await collectWebVitals(page)
    reportVitals('Confirmation (/bookings/{id}/confirmation)', vitals)

    await test.expect(page.locator('h1').first()).toContainText('Booking confirmed')

    pushVitalsAnnotations(testInfo, vitals)
  })
})
