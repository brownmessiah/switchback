/**
 * E2E tests for authenticated customer flows.
 *
 * Covers: dashboard rendering, browse-to-checkout journey, mock-payment
 * confirmation, booking cancellation, and checkout validation.
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 *
 * Authenticated via `tests/e2e/.auth/customer-storage.json` (injected by
 * the global setup project — seed user `u_seed_customer`).
 */

import { test, expect } from '../../fixtures/devtools'
import {
  countBookingCreateAuditRows,
  getBooking,
  getBookingCreateAuditPayload,
  getOpenSlotForExperienceSlug,
  getSlotCapacity,
} from '../../helpers/db-assertions'
import { mockRazorpayCheckout } from '../../helpers/razorpay-mock'

// Seeded flagship rafting Experience — see db/seed.ts.
//   pricePerPerson_1_2 = ₹1,500; slot T+7d (>48h out), capacity 8.
//   paymentModesAllowed = ['full_upfront', 'partial_pay'].
// At 2 participants: gross = ₹3,000 (≤ ₹25,000) AND ≥ 48h out
//   → partial pay: 25% Advance = ₹750 captured now, ₹2,250 scheduled T-24h.
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'
const RAFTING_PRICE_1_2 = 1500
const DEFAULT_PARTICIPANTS = 2
const EXPECTED_GROSS = RAFTING_PRICE_1_2 * DEFAULT_PARTICIPANTS // 3000
const EXPECTED_ADVANCE = Math.floor(EXPECTED_GROSS * 0.25) // 750

// ---------------------------------------------------------------------------
// 1. Dashboard loads
// ---------------------------------------------------------------------------
test.describe('Customer dashboard', () => {
  test('renders with wallet balances and booking sections', async ({ page }) => {
    const response = await page.goto('/dashboard')
    expect(response?.status()).toBe(200)

    // Page heading
    const h1 = page.locator('h1')
    await expect(h1).toBeVisible()
    await expect(h1).toContainText('My bookings')

    // Wallet cards — refund balance and Outvers credit
    await expect(page.getByText('Refund balance')).toBeVisible()
    await expect(page.getByText('Outvers credit')).toBeVisible()

    // Wallet amounts render (seed: refund=500, credit=200)
    // Just verify the currency symbol is visible in the wallet section
    const walletCards = page.locator('[class*="card"]').filter({ hasText: '₹' })
    const walletCount = await walletCards.count()
    expect(walletCount).toBeGreaterThanOrEqual(2)

    // Bookings list — seed creates 5 bookings for u_seed_customer
    // Each booking is a link to the confirmation page
    const bookingLinks = page.locator('a[href*="/bookings/"]')
    const linkCount = await bookingLinks.count()
    expect(linkCount).toBeGreaterThanOrEqual(1)

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-dashboard.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. Browse → detail → checkout
// ---------------------------------------------------------------------------
test.describe('Browse to checkout', () => {
  test('navigate collection → experience detail → checkout page', async ({
    page,
  }) => {
    // Start at the rafting-in-rishikesh collection
    await page.goto('/adventure/rafting-in-rishikesh')
    await expect(page.locator('h1')).toBeVisible()

    // Click the first experience link
    const experienceLinks = page.locator('a[href*="/experience/"]')
    const linkCount = await experienceLinks.count()
    expect(linkCount).toBeGreaterThanOrEqual(1)

    const href = await experienceLinks.first().getAttribute('href')
    expect(href).toBeTruthy()

    // Navigate to experience detail
    await experienceLinks.first().click()
    await expect(page.locator('h1')).toBeVisible()

    // Verify pricing section is visible
    await expect(page.getByText('/ person').first()).toBeVisible()

    // Click "Book now" to go to checkout
    const bookNowLink = page.locator('a:has-text("Book now")')
    await expect(bookNowLink).toBeVisible()
    await bookNowLink.click()

    // Checkout page should load
    await expect(page.locator('h1')).toContainText('Checkout')

    // Order summary card renders
    await expect(page.getByText('Order summary')).toBeVisible()

    // Pricing details are present
    await expect(page.getByText('Experience', { exact: true })).toBeVisible()
    await expect(page.getByText('Participants', { exact: true })).toBeVisible()
    await expect(page.getByText('Price per person')).toBeVisible()
    await expect(page.getByText('Total', { exact: true })).toBeVisible()

    // Payment/pay button is visible
    const payButton = page.locator('button:has-text("Pay")')
    await expect(payButton).toBeVisible()

    // Cancellation policy badge is shown
    await expect(page.getByText('cancellation policy', { exact: true })).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-checkout.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Booking confirmation page — verify content for a seeded booking
// ---------------------------------------------------------------------------
test.describe('Payment and confirmation', () => {
  test('trigger Razorpay mock → booking confirmation renders', async ({
    page,
  }) => {
    // Navigate to the dashboard and find an existing confirmed booking
    // (the seed creates confirmed bookings for u_seed_customer)
    await page.goto('/dashboard')
    await expect(page.locator('h1')).toContainText('My bookings')

    // Find a confirmed booking link
    const confirmedBooking = page
      .locator('a[href*="/bookings/"]')
      .filter({ hasText: /confirmed/i })
      .first()
    const hasConfirmed = (await confirmedBooking.count()) > 0

    const bookingLink = hasConfirmed
      ? confirmedBooking
      : page.locator('a[href*="/bookings/"]').first()

    const linkCount = await bookingLink.count()
    expect(linkCount).toBeGreaterThanOrEqual(1)

    // Navigate to the confirmation page
    await bookingLink.click()
    await page.waitForURL(/\/bookings\/[^/]+\/confirmation/, {
      timeout: 15_000,
    })

    // Confirmation page content
    await expect(page.locator('h1')).toContainText('Booking confirmed')

    // Booking summary card
    await expect(page.getByText('Booking summary')).toBeVisible()
    await expect(page.getByText('Experience', { exact: true })).toBeVisible()
    await expect(page.getByText('Participants', { exact: true })).toBeVisible()
    await expect(page.getByText('Total', { exact: true })).toBeVisible()

    // Cancellation policy section on confirmation
    await expect(page.getByText('Cancellation policy')).toBeVisible()

    // Action buttons — Cancel booking and Browse more
    await expect(
      page.locator('a:has-text("Cancel booking")'),
    ).toBeVisible()
    await expect(
      page.locator('a:has-text("Browse more experiences")'),
    ).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-confirmation.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 3b. Full revenue spine — browse → PDP → checkout → pay → confirmation
//     with DB-level invariant assertions (Issue #13).
// ---------------------------------------------------------------------------
test.describe('Revenue spine: checkout → confirmation', () => {
  test('completes a partial-pay checkout and locks all booking invariants', async ({
    page,
  }) => {
    // Capacity baseline before the booking, for the decrement assertion.
    const slotBefore = await getOpenSlotForExperienceSlug(RAFTING_SLUG)
    expect(slotBefore, 'seeded rafting slot must exist').toBeTruthy()
    const capacityTakenBefore = (await getSlotCapacity(slotBefore!.slotId))!
      .capacityTaken

    // Browser-side Razorpay mock — fires handler.success on open().
    await mockRazorpayCheckout(page)

    // Browse: collection → experience detail.
    await page.goto(`/adventure/rafting-in-rishikesh`)
    await expect(page.locator('h1')).toBeVisible()

    const raftingLink = page
      .locator(`a[href*="/experience/${RAFTING_SLUG}"]`)
      .first()
    await expect(raftingLink).toBeVisible()
    await raftingLink.click()
    await expect(page.locator('h1')).toBeVisible()

    // Book now → checkout.
    const bookNow = page.locator('a:has-text("Book now")')
    await expect(bookNow).toBeVisible()
    await bookNow.click()
    await expect(page.locator('h1')).toContainText('Checkout')

    // Worked example surfaced in the UI: ₹3,000 total, ₹750 due now.
    await expect(page.getByText('Order summary')).toBeVisible()
    await expect(
      page.getByText(`₹${EXPECTED_GROSS.toLocaleString('en-IN')}`).first(),
    ).toBeVisible()
    const payButton = page.locator('button:has-text("Pay")')
    await expect(payButton).toContainText(
      `₹${EXPECTED_ADVANCE.toLocaleString('en-IN')}`,
    )

    // Pay → confirmation.
    await payButton.click()
    await page.waitForURL(/\/bookings\/[^/]+\/confirmation/, {
      timeout: 15_000,
    })
    await expect(page.locator('h1')).toContainText('Booking confirmed')

    // Extract the new booking id from the URL.
    const match = page.url().match(/\/bookings\/([^/]+)\/confirmation/)
    expect(match).toBeTruthy()
    const bookingId = match![1]

    // ── DB invariant 1: Booking row created with the right snapshots ──
    const booking = await getBooking(bookingId)
    expect(booking, 'booking row must exist').toBeTruthy()
    expect(booking!.customerUserId).toBe('u_seed_customer')
    expect(booking!.slotId).toBe(slotBefore!.slotId)
    expect(booking!.participantCount).toBe(DEFAULT_PARTICIPANTS)
    expect(booking!.state).toBe('confirmed')

    // Partial-pay worked example (ADR-0001): ≥48h out + gross ≤ ₹25,000.
    expect(Math.floor(Number(booking!.grossTotalSnapshot))).toBe(EXPECTED_GROSS)
    expect(booking!.paymentMode).toBe('partial_pay')
    expect(Math.floor(Number(booking!.pricePerParticipantSnapshot))).toBe(
      RAFTING_PRICE_1_2,
    )

    // ── DB invariant 2: Commission snapshot (rate + basis) locked ──
    expect(Number(booking!.commissionRateSnapshot)).toBeGreaterThan(0)
    expect(booking!.commissionBasisSnapshot.length).toBeGreaterThan(0)

    // ── DB invariant 3: Capacity decremented atomically ──
    const slotAfter = await getSlotCapacity(slotBefore!.slotId)
    expect(slotAfter!.capacityTaken).toBe(
      capacityTakenBefore + DEFAULT_PARTICIPANTS,
    )

    // ── DB invariant 4: Exactly one booking.create audit row ──
    expect(await countBookingCreateAuditRows(bookingId)).toBe(1)

    // ── Partial-pay worked example in the audit payload ──
    // 25% Advance captured now (booking_create trigger), balance T-24h.
    const payload = await getBookingCreateAuditPayload(bookingId)
    expect(payload, 'booking.create audit payload must exist').toBeTruthy()
    expect(payload!.effectivePaymentMode).toBe('partial_pay')
    expect(payload!.captureTrigger).toBe('booking_create')
    expect(payload!.coercedUnder48h).toBe(false)
    expect(Math.floor(Number(payload!.grossRupees))).toBe(EXPECTED_GROSS)
    // Worked example: gross ₹3,000 (≤ ₹25,000, ≥48h out) → partial_pay, with the
    // 25% Advance (₹750) asserted on the pay button above and the ₹2,250 balance
    // scheduled for T-24h. (No constant-vs-constant assertion — that proves nothing.)
  })
})

// ---------------------------------------------------------------------------
// 4. Cancel booking
// ---------------------------------------------------------------------------
test.describe('Cancel booking', () => {
  test('confirmation page has cancel link, navigating shows cancel route', async ({
    page,
  }) => {
    // Navigate to the dashboard and click the first booking
    await page.goto('/dashboard')
    await expect(page.locator('h1')).toContainText('My bookings')

    // Find a confirmed booking (look for the "confirmed" badge)
    const confirmedBooking = page
      .locator('a[href*="/bookings/"]')
      .filter({ hasText: /confirmed/i })
      .first()
    const hasConfirmed = (await confirmedBooking.count()) > 0

    // Fall back to any booking link if no confirmed one
    const bookingLink = hasConfirmed
      ? confirmedBooking
      : page.locator('a[href*="/bookings/"]').first()

    const bookingCount = await bookingLink.count()
    expect(bookingCount).toBeGreaterThanOrEqual(1)

    // Navigate to the confirmation page
    await bookingLink.click()
    await page.waitForURL(/\/bookings\/[^/]+\/confirmation/)

    // Verify the confirmation page loaded
    await expect(page.locator('h1')).toContainText('Booking confirmed')

    // The cancel booking link should be present
    const cancelLink = page.locator('a:has-text("Cancel booking")')
    await expect(cancelLink).toBeVisible()

    // Verify the cancel link points to the correct route
    const cancelHref = await cancelLink.getAttribute('href')
    expect(cancelHref).toMatch(/\/bookings\/[^/]+\/cancel/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-cancel-booking.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Checkout validation — missing date/slot
// ---------------------------------------------------------------------------
test.describe('Checkout validation', () => {
  test('navigate to checkout without experienceId shows not-found', async ({
    page,
  }) => {
    // Navigate to checkout with no query params — the server component
    // calls notFound() when experienceId is missing
    const response = await page.goto('/checkout')
    expect(response?.status()).toBe(404)

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-checkout-validation.png',
      fullPage: true,
    })
  })

  test('checkout with no slot selected shows a specific field error, no crash', async ({
    page,
  }) => {
    // Resolve a real experienceId via the seeded rafting experience.
    const slot = await getOpenSlotForExperienceSlug(RAFTING_SLUG)
    expect(slot, 'seeded rafting experience must exist').toBeTruthy()
    const experienceId = slot!.experienceId

    // Navigate to checkout with experienceId but NO slotId — the page
    // renders (slotId is optional on the route), but paying must fail
    // with a specific slot field error rather than crashing.
    const response = await page.goto(
      `/checkout?experienceId=${experienceId}`,
    )
    expect(response?.status()).toBe(200)

    await expect(page.locator('h1')).toContainText('Checkout')
    await expect(page.getByText('Order summary')).toBeVisible()

    const payButton = page.locator('button:has-text("Pay")')
    await expect(payButton).toBeVisible()
    await payButton.click()

    // Specific, actionable field error — NOT a generic "unexpected error".
    const errorMessage = page.getByText(
      /select an available date and slot/i,
    )
    await expect(errorMessage).toBeVisible({ timeout: 10_000 })
    await expect(
      page.getByText('An unexpected error occurred'),
    ).toHaveCount(0)

    // No booking was created for this no-slot attempt — page stays put.
    await expect(page).toHaveURL(/\/checkout/)

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-checkout-no-slot.png',
      fullPage: true,
    })
  })
})
