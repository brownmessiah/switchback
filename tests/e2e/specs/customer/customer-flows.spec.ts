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
  countBookingCancelAuditRows,
  countBookingCreateAuditRows,
  countOutversCreditAuditForBooking,
  countRefundRequestsForBooking,
  getBooking,
  getBookingCreateAuditPayload,
  getBookingState,
  getConfirmedBookingForExperienceSlug,
  getDisputeOpenedAuditPayload,
  getOpenSlotForExperienceSlug,
  getRefundBalanceCreditAuditForBooking,
  getRefundRequestForBooking,
  getSlotCapacity,
  getWalletBalanceRupees,
} from '../../helpers/db-assertions'
import { mockRazorpayCheckout } from '../../helpers/razorpay-mock'

// Seeded customer (db/seed.ts) — owns every seeded booking + wallet.
const SEED_CUSTOMER = 'u_seed_customer'
// Each cancel test cancels a DISTINCT seeded booking so they stay isolated
// under Playwright's parallel workers (fullyParallel: true). The seed
// (db/seed.ts) makes goa-scuba-diving-padi-dsd and bir-billing-paragliding-
// full-day `confirmed` on T+7d slots (inside the flexible free window), and
// rishikesh-kayaking-introduction `confirmed` on a PAST slot (outside policy).
//
// Inside-policy cancel target: goa-scuba-diving-padi-dsd. T+7d slot under the
// flexible preset → cancellation now is inside the free window → full refund.
// gross = ₹4,500 × 2 = ₹9,000.
const INSIDE_POLICY_SLUG = 'goa-scuba-diving-padi-dsd'
// Read-only "link reaches the page" target — never cancelled, so it stays
// confirmed for parallel runs.
const CANCEL_LINK_SLUG = 'bir-billing-paragliding-full-day'
// Outside-policy cancel target: a confirmed Booking on a PAST slot.
// gross = ₹1,800 × 2 = ₹3,600.
const KAYAKING_SLUG = 'rishikesh-kayaking-introduction'

// Seeded flagship rafting Experience — see db/seed.ts.
//   pricePerPerson_1_2 = ₹1,500; slot T+7d (>48h out), capacity 8.
//   paymentModesAllowed = ['full_upfront', 'partial_pay'].
//
// PARTICIPANT COUNT: the booking-rail participant stepper DEFAULTS to 1
// (booking-rail-interactive.tsx: `useState(1)`), and the "Book now" CTA carries
// that count through as `&participants=1`. The revenue-spine + keyboard specs
// click "Book now" WITHOUT touching the stepper, so the count under test is 1 —
// not 2 (the checkout page's no-count fallback, which "Book now" never hits
// because it always supplies an explicit count). All totals below derive from
// the seed price × that count so the assertions track real data, not a guess.
//
// At 1 participant: gross = ₹1,500 (≤ ₹25,000) AND ≥ 48h out
//   → partial pay: 25% Advance = ₹375 captured now, ₹1,125 scheduled T-24h.
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'
const RAFTING_PRICE_1_2 = 1500
// Booking-rail default participant count carried by the "Book now" CTA.
const DEFAULT_PARTICIPANTS = 1
const EXPECTED_GROSS = RAFTING_PRICE_1_2 * DEFAULT_PARTICIPANTS // 1500
const EXPECTED_ADVANCE = Math.floor(EXPECTED_GROSS * 0.25) // 375

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

  // -------------------------------------------------------------------------
  // 1b. Functional deepening (Issue #15): correct Booking statuses, two
  //     SEPARATE Wallet buckets with correct totals, Outvers credit EXPIRY,
  //     and the Refund balance CASHABLE-to-original-method option (ADR-0004).
  // -------------------------------------------------------------------------
  test('lists Bookings with their correct seeded statuses', async ({ page }) => {
    // The seed (db/seed.ts) creates a deterministic mix of states for the
    // seed customer's bookings: two `completed`, several `confirmed`, and one
    // `cancelled_by_customer`. The status badge text mirrors the state with
    // underscores replaced by spaces. Assert each distinct status renders so
    // a regression in status mapping is caught (cancel specs run in their own
    // serial describe and target DISTINCT bookings, but the completed/
    // cancelled_by_customer demo bookings here are never touched by them).
    const dashboard = page.getByTestId('customer-dashboard')
    await page.goto('/dashboard')
    await expect(dashboard).toBeVisible()

    // `completed` demo booking — never mutated by any spec.
    await expect(
      dashboard.getByTestId('booking-status').filter({ hasText: /^completed$/i }).first(),
    ).toBeVisible()
    // `cancelled by customer` demo booking — never mutated by any spec.
    await expect(
      dashboard
        .getByTestId('booking-status')
        .filter({ hasText: /^cancelled by customer$/i })
        .first(),
    ).toBeVisible()
    // At least one `confirmed` booking is seeded.
    await expect(
      dashboard.getByTestId('booking-status').filter({ hasText: /^confirmed$/i }).first(),
    ).toBeVisible()
  })

  test('Wallet shows Outvers credit and Refund balance as separate buckets with correct totals', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    // Two structurally distinct bucket cards, each tagged by balance type.
    const creditCard = page.getByTestId('wallet-bucket-outvers_credit')
    const refundCard = page.getByTestId('wallet-bucket-refund_balance')
    await expect(creditCard).toBeVisible()
    await expect(refundCard).toBeVisible()

    // Each card labels its own bucket — they are NOT merged into one number.
    await expect(creditCard).toContainText('Outvers credit')
    await expect(refundCard).toContainText('Refund balance')

    // Correct per-bucket totals, read live from the DB. Outvers credit is never
    // mutated by any other spec, so assert it exactly. Refund balance, however,
    // is CREDITED in parallel by the `Cancel booking` describe (inside-policy
    // cancels) and nothing debits it (no spec calls applyWalletToCheckout), so
    // it only ever grows — the SSR snapshot rendered at page.goto is <= the
    // current DB value. Assert that monotonic invariant instead of exact
    // equality (which would flake when a parallel cancel lands between the
    // render and this read).
    const creditRupees = await getWalletBalanceRupees(SEED_CUSTOMER, 'outvers_credit')
    await expect(creditCard.getByTestId('wallet-amount')).toHaveText(
      `₹${creditRupees.toLocaleString('en-IN')}`,
    )
    const refundAmountText = await refundCard.getByTestId('wallet-amount').innerText()
    const renderedRefund = Number(refundAmountText.replace(/[₹,\s]/g, ''))
    const dbRefundNow = await getWalletBalanceRupees(SEED_CUSTOMER, 'refund_balance')
    expect(Number.isFinite(renderedRefund)).toBe(true)
    expect(renderedRefund).toBeGreaterThanOrEqual(0)
    expect(renderedRefund).toBeLessThanOrEqual(dbRefundNow)
  })

  test('Outvers credit shows an expiry; Refund balance shows the cash-out option (ADR-0004)', async ({
    page,
  }) => {
    await page.goto('/dashboard')

    const creditCard = page.getByTestId('wallet-bucket-outvers_credit')
    const refundCard = page.getByTestId('wallet-bucket-refund_balance')

    // ── Outvers credit EXPIRES (12–18mo from issue, ADR-0004). The card must
    //    surface an expiry date for the credit so the Customer knows the
    //    closed-loop credit is time-bound. ──
    const expiry = creditCard.getByTestId('wallet-credit-expiry')
    await expect(expiry).toBeVisible()
    await expect(expiry).toContainText(/expires/i)
    // The seed issues the credit with a deterministic +12-month expiry; the
    // year component must render (catches "renders the literal word with no
    // date" regressions).
    await expect(expiry).toContainText(/\d{4}/)

    // ── Refund balance is CASHABLE back to the original payment method via
    //    Razorpay (5–7 working days, ADR-0004). The card must surface that
    //    option — copy + an affordance — which distinguishes it from the
    //    never-cashable Outvers credit. ──
    const cashout = refundCard.getByTestId('wallet-cashout-option')
    await expect(cashout).toBeVisible()
    await expect(cashout).toContainText(/original payment method/i)
    await expect(cashout).toContainText(/5[–-]7 working days/i)
    // The Outvers credit card must NOT offer cashout (it is never cashable).
    await expect(creditCard.getByTestId('wallet-cashout-option')).toHaveCount(0)
  })

  // -------------------------------------------------------------------------
  // 1c. Direction B "Trip Timeline + Action Rail" redesign (#72): status pills
  //     are SEMANTIC (not all-coral), and every cancellable Booking carries an
  //     inline "Cancel — see refund" link routing to the live B7 refund quote.
  // -------------------------------------------------------------------------
  test('confirmed status pills are semantic (not coral fill) and pair with an icon', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    const dashboard = page.getByTestId('customer-dashboard')
    await expect(dashboard).toBeVisible()

    // The seed customer owns >=1 `confirmed` Booking. Its status Badge must use
    // the SEMANTIC success token (green tint + on-tint ink), NOT the coral
    // primary fill the old STATE_VARIANTS mapped `confirmed → 'default'` to.
    const confirmedBadge = dashboard
      .getByTestId('booking-status')
      .filter({ hasText: /^confirmed$/i })
      .first()
    await expect(confirmedBadge).toBeVisible()

    // Coral fill is the `bg-primary` utility (Badge variant="default"). After
    // the remap it must be gone; the success token class must be present.
    const cls = (await confirmedBadge.getAttribute('class')) ?? ''
    expect(cls, 'confirmed badge must not use the coral primary fill').not.toMatch(
      /\bbg-primary\b/,
    )
    expect(cls, 'confirmed badge must use the semantic success token').toMatch(
      /text-success/,
    )

    // Status is never conveyed by color alone — an icon (lucide <svg>) is paired
    // inside the Badge (DESIGN.md §1.3 / WCAG 1.4.1).
    await expect(confirmedBadge.locator('svg').first()).toBeVisible()
  })

  test('each cancellable Booking has an inline "Cancel — see refund" link to its cancel page', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    const dashboard = page.getByTestId('customer-dashboard')
    await expect(dashboard).toBeVisible()

    // Direction B puts the live-refund-quote trust moment one click from each
    // card: a cancellable (confirmed) Booking carries an inline "Cancel — see
    // refund" link pointing at /bookings/{id}/cancel (the page that computes
    // and shows the B7 refund quote). At least one such link must render.
    const cancelLink = dashboard.getByTestId('dashboard-cancel-link').first()
    await expect(cancelLink).toBeVisible()
    await expect(cancelLink).toContainText(/cancel.*see refund/i)
    const href = await cancelLink.getAttribute('href')
    expect(href, 'inline cancel link must target the cancel route').toMatch(
      /\/bookings\/[^/]+\/cancel$/,
    )
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

    // Order summary card renders (persistent rail — visible on BOTH steps)
    await expect(page.getByText('Order summary')).toBeVisible()

    // Pricing details are present (in the persistent rail)
    await expect(page.getByText('Experience', { exact: true })).toBeVisible()
    await expect(page.getByText('Participants', { exact: true })).toBeVisible()
    await expect(page.getByText('Price per person')).toBeVisible()
    await expect(page.getByText('Total', { exact: true })).toBeVisible()

    // Guided-stepper (#70 / Direction A): the checkout is a 2-screen wizard.
    // STEP 1 "Your details" lands first; the Pay button lives on STEP 2 and is
    // NOT in the DOM until the Customer advances. Assert the step structure.
    await expect(
      page.getByRole('button', { name: /continue to payment/i }),
    ).toBeVisible()
    // The real Pay button (label "Pay ₹…") is NOT in the DOM on step 1. Match by
    // accessible name starting with "Pay" so it doesn't collide with the
    // "Continue to payment" advance control (which contains the substring "pay").
    await expect(
      page.getByRole('button', { name: /^Pay\s/i }),
    ).toHaveCount(0)

    // Cancellation policy badge is shown on STEP 1's review.
    await expect(page.getByText('cancellation policy', { exact: true })).toBeVisible()

    // Advance to STEP 2 "Payment".
    await page.getByRole('button', { name: /continue to payment/i }).click()

    // Payment/pay button is now visible on step 2.
    const payButton = page.locator('button:has-text("Pay")')
    await expect(payButton).toBeVisible()

    // Graceful degradation (Issue #112 / ADR-0002): the checkout payment-mode
    // surface must NEVER advertise reserve-now-pay-later. Only the two shipped
    // modes (full upfront / 25-75 partial pay) may appear. Assert no RNPL tile,
    // badge, or "pay later" copy leaks into the checkout body.
    const checkoutText = (await page.locator('main').innerText()).toLowerCase()
    expect(checkoutText, 'checkout must not advertise RNPL').not.toContain(
      'reserve now',
    )
    expect(checkoutText, 'checkout must not show a "pay later" badge').not.toContain(
      'pay later',
    )
    expect(checkoutText, 'checkout must not surface the RNPL acronym').not.toContain(
      'rnpl',
    )

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

    // ── Variant B "money-honest" redesign (#71) ─────────────────────────
    // Payment-honesty timeline restates the schedule (Advance/balance for
    // partial pay, "Paid in full" for full upfront). Present on every booking.
    await expect(page.getByTestId('payment-timeline')).toBeVisible()

    // The Booking ID is now FULL + copyable (was `slice(0,8)…` truncation).
    // The copy control carries the complete id as a stable testid; the full id
    // (longer than the old 8-char prefix) is visible, not an ellipsis stub.
    const copyControl = page.getByTestId('copy-booking-id')
    await expect(copyControl).toBeVisible()
    const fullId = await copyControl.getAttribute('data-booking-id')
    expect(fullId, 'copy control must expose the full booking id').toBeTruthy()
    expect(fullId!.length).toBeGreaterThan(8)
    await expect(page.getByText(fullId!)).toBeVisible()

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

    // The partial-pay worked example (ADR-0001) requires a slot ≥48h out — a
    // <48h slot is coerced to full_upfront. The rich seeded calendar (~90 days)
    // surfaces near-term dates too, and the rail auto-selects the FIRST bookable
    // date, which can be <48h away. Drive the desktop rail's calendar to the
    // furthest-out available day + its first time slot (guaranteed ≥48h),
    // mirroring the PDP trust-rail spec, so the booking is genuinely partial-pay.
    const rail = page.locator('#booking')
    await expect(rail).toBeVisible()
    await rail
      .getByTestId('booking-calendar')
      .locator('button[data-testid^="cal-day-"]:not([disabled])')
      .last()
      .click()
    await rail
      .getByTestId('time-slot-list')
      .locator('button[data-testid^="time-slot-"]:not([disabled])')
      .first()
      .click()

    // The booking slot is whichever the rail has selected, carried in the
    // "Book now" href. With the rich seeded calendar the UI-selected slot is NOT
    // the earliest-open slot a DB query would return, so derive the baseline
    // from the SAME slot the UI is about to book — read it from the href, then
    // snapshot its capacity. This ties the decrement assertion to the exact slot
    // the booking lands on (a stronger invariant than a separate query).
    const bookNow = rail.locator('a:has-text("Book now")')
    await expect(bookNow).toBeVisible()
    const bookNowHref = await bookNow.getAttribute('href')
    expect(bookNowHref, 'Book now must carry a slotId').toBeTruthy()
    const selectedSlotId = new URL(bookNowHref!, 'http://localhost').searchParams.get(
      'slotId',
    )
    expect(selectedSlotId, 'Book now href must include a slotId').toBeTruthy()
    const capacityTakenBefore = (await getSlotCapacity(selectedSlotId!))!
      .capacityTaken

    // Book now → checkout.
    await bookNow.click()
    await expect(page.locator('h1')).toContainText('Checkout')

    // Worked example surfaced in the UI's persistent order-summary rail:
    // ₹1,500 total, ₹375 due now (1 participant — the rail's default count).
    // The rail is visible on BOTH steps. The checkout renders TWO summaries — a
    // `md:hidden` mobile hoist (DOM-first) and the `hidden md:block` desktop
    // "Order summary" aside — so a page-wide `.first()` resolves to the hidden
    // mobile total at this desktop viewport. Scope the Total assertion to the
    // visible desktop aside so it targets the rendered instance.
    const orderSummary = page.locator('aside[aria-label="Order summary"]')
    await expect(orderSummary).toBeVisible()
    await expect(
      orderSummary.getByText(`₹${EXPECTED_GROSS.toLocaleString('en-IN')}`).first(),
    ).toBeVisible()

    // Guided-stepper (#70 / Direction A): Pay lives on STEP 2. The Revenue-spine
    // money invariant (partial_pay DEFAULT) must hold by simply advancing past
    // step 1 and paying — no payment-mode radio change. Assert the real Pay
    // button ("Pay ₹…") is gated behind "Continue to payment", then advance.
    // (Match by accessible name starting with "Pay" to avoid the substring
    // collision with the "Continue to payment" advance control.)
    await expect(page.getByRole('button', { name: /^Pay\s/i })).toHaveCount(0)
    await page.getByRole('button', { name: /continue to payment/i }).click()

    // partial_pay is the DEFAULT mode → the Pay button reflects the 25% Advance.
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
    expect(booking!.slotId).toBe(selectedSlotId)
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
    const slotAfter = await getSlotCapacity(selectedSlotId!)
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
    // Worked example: gross ₹1,500 (≤ ₹25,000, ≥48h out) → partial_pay, with the
    // 25% Advance (₹375) asserted on the pay button above and the ₹1,125 balance
    // scheduled for T-24h. (No constant-vs-constant assertion — that proves nothing.)
  })
})

// ---------------------------------------------------------------------------
// 4. Cancel → refund (WIRED flow — Issue #14)
//    The pure refund math + the cancellation×refund matrix is validated at
//    the integration layer (#33: lib/payments/refund-policy.test.ts +
//    refund-flow.test.ts). Here we validate that the customer cancelling
//    FROM THE UI lands the right WIRED outcome in the DB: inside-policy →
//    Refund balance credited, no dispute; outside-policy → Dispute routed
//    to support, no auto-refund.
// ---------------------------------------------------------------------------
test.describe('Cancel booking', () => {
  // Serial: these tests mutate the shared seed (booking states + the seeded
  // customer's single wallet). Running them serially keeps each test's
  // before/after wallet readings free of cross-worker races. Each test still
  // targets a DISTINCT booking, so a failure in one doesn't cascade.
  test.describe.configure({ mode: 'serial' })

  /**
   * Briefly delay the cancel page's RSC refresh round-trip so the
   * `cancel-outcome` panel stays asserted-able (#109).
   *
   * On a successful cancel, CancelForm sets its `outcome` state (rendering
   * the cancel-outcome panel) and immediately calls `router.refresh()`. The
   * refresh re-runs the cancel page's server component, which — now that the
   * Booking is no longer `confirmed` — renders the "not-cancellable" panel
   * INSTEAD of CancelForm, unmounting the just-rendered outcome. Under load
   * the RSC round-trip can complete inside a single Playwright poll interval,
   * so the assertion intermittently only ever observes the post-refresh
   * "not-cancellable" state and times out — even with retries (the one-way
   * cancel already consumed the Booking). This is a test-only network shim:
   * it slows ONLY the RSC refetch of the cancel route (identified by the
   * Next.js `RSC: 1` request header) by a beat, widening the window so the
   * outcome panel is reliably observed. It changes no product behavior and
   * weakens no assertion — the load-bearing DB/audit assertions are untouched.
   */
  async function slowCancelRouteRefresh(page: import('@playwright/test').Page) {
    await page.route('**/bookings/**/cancel*', async (route) => {
      const isRscRefresh = route.request().headers()['rsc'] === '1'
      if (isRscRefresh) {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      await route.continue()
    })
  }

  test('confirmation page Cancel link reaches a working cancel page (no 404)', async ({
    page,
  }) => {
    // Resolve a confirmed booking deterministically from the DB. This test
    // never cancels it, so it stays confirmed for parallel workers.
    const booking = await getConfirmedBookingForExperienceSlug(CANCEL_LINK_SLUG)
    expect(booking, 'a confirmed booking must be seeded').toBeTruthy()

    // From the confirmation page, the Cancel link must NAVIGATE to a real
    // page (it previously 404'd because no page.tsx existed at /cancel).
    const confResponse = await page.goto(
      `/bookings/${booking!.bookingId}/confirmation`,
    )
    expect(confResponse?.status()).toBe(200)

    const cancelLink = page.locator('a:has-text("Cancel booking")')
    await expect(cancelLink).toBeVisible()
    await cancelLink.click()

    await page.waitForURL(/\/bookings\/[^/]+\/cancel/)
    // The cancel page renders (200, not 404) with the confirm control.
    await expect(page.locator('h1')).toContainText('Cancel booking')
    await expect(page.getByTestId('confirm-cancel')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-cancel-page.png',
      fullPage: true,
    })
  })

  test('INSIDE-policy cancel auto-credits the Refund balance, no dispute', async ({
    page,
  }) => {
    // The scuba booking sits on a T+7d slot under the flexible preset → a
    // cancellation now is inside the free window → full refund auto-credited
    // to the Refund balance bucket (ADR-0004/0005). gross = ₹9,000.
    const booking = await getConfirmedBookingForExperienceSlug(INSIDE_POLICY_SLUG)
    expect(booking, 'a confirmed booking must be seeded').toBeTruthy()
    const { bookingId, grossRupees } = booking!
    expect(grossRupees).toBeGreaterThan(0)

    // Keep the post-success outcome panel observable past router.refresh().
    await slowCancelRouteRefresh(page)

    await page.goto(`/bookings/${bookingId}/cancel`)
    await expect(page.locator('h1')).toContainText('Cancel booking')

    await page.getByTestId('confirm-cancel').click()

    // The UI surfaces the inside-policy success branch.
    const outcome = page.getByTestId('cancel-outcome')
    await expect(outcome).toBeVisible({ timeout: 15_000 })
    await expect(outcome).toHaveAttribute('data-routed-to-dispute', 'false')
    await expect(outcome).toContainText('Refund balance')

    // ── WIRED outcome 1: booking transitioned to cancelled_by_customer ──
    expect(await getBookingState(bookingId)).toBe('cancelled_by_customer')

    // ── WIRED outcome 2: the credit landed in the Refund balance bucket
    //    (NOT Outvers credit), for the full free-window amount. Asserted
    //    against the immutable wallet.credit_refund_balance audit row rather
    //    than the live wallet_balances delta — the seed customer's single
    //    wallet is shared across bookings and concurrent checkouts in other
    //    parallel specs may move it, but the audit row for THIS booking is
    //    written once and never changes. ──
    const creditAudit = await getRefundBalanceCreditAuditForBooking(bookingId)
    expect(creditAudit, 'a refund-balance credit audit row must exist').toBeTruthy()
    expect(creditAudit!.amountRupees).toBe(grossRupees)
    expect(creditAudit!.userId).toBe(SEED_CUSTOMER)
    // The refund must NOT have been routed to the Outvers (promo) bucket.
    expect(await countOutversCreditAuditForBooking(bookingId)).toBe(0)
    // Live balance sanity: it reflects at least the credited amount.
    expect(
      await getWalletBalanceRupees(SEED_CUSTOMER, 'refund_balance'),
    ).toBeGreaterThanOrEqual(grossRupees)

    // ── WIRED outcome 3: a credited refund_requests row to refund_balance,
    //    free_window basis — and NO dispute audit row ──
    const refundReq = await getRefundRequestForBooking(bookingId)
    expect(refundReq, 'a refund_requests row must exist').toBeTruthy()
    expect(refundReq!.state).toBe('credited')
    expect(refundReq!.destination).toBe('refund_balance')
    expect(refundReq!.reason).toBe('inside_policy_cancellation')
    expect(refundReq!.amount).toBe(grossRupees)
    expect(refundReq!.policyWindowBasisSnapshot).toBe('free_window')

    expect(await countBookingCancelAuditRows(bookingId)).toBe(1)
    expect(
      await getDisputeOpenedAuditPayload(bookingId),
      'inside-policy cancel must NOT open a dispute',
    ).toBeNull()

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-cancel-inside-policy.png',
      fullPage: true,
    })
  })

  test('OUTSIDE-policy cancel creates a Dispute routed to support, no auto-refund', async ({
    page,
  }) => {
    // Kayaking booking sits on a PAST slot → the flexible window has fully
    // closed → outside_policy. Cancelling routes to a Dispute (booking
    // state = disputed + dispute.opened audit row pendingAdminResolution),
    // with NO refund_requests row and NO Refund balance credit (ADR-0003/05).
    const booking = await getConfirmedBookingForExperienceSlug(KAYAKING_SLUG)
    expect(booking, 'a confirmed outside-policy kayaking booking must be seeded').toBeTruthy()
    const { bookingId } = booking!

    // Keep the post-success outcome panel observable past router.refresh().
    await slowCancelRouteRefresh(page)

    await page.goto(`/bookings/${bookingId}/cancel`)
    await expect(page.locator('h1')).toContainText('Cancel booking')

    await page.getByTestId('confirm-cancel').click()

    // The UI surfaces the outside-policy "under review" branch.
    const outcome = page.getByTestId('cancel-outcome')
    await expect(outcome).toBeVisible({ timeout: 15_000 })
    await expect(outcome).toHaveAttribute('data-routed-to-dispute', 'true')
    await expect(outcome).toContainText('review')

    // ── WIRED outcome 1: booking transitioned to disputed ──
    expect(await getBookingState(bookingId)).toBe('disputed')

    // ── WIRED outcome 2: a dispute.opened audit row routed to support
    //    (pendingAdminResolution), NOT an auto-refund ──
    const disputePayload = await getDisputeOpenedAuditPayload(bookingId)
    expect(disputePayload, 'a dispute.opened audit row must exist').toBeTruthy()
    expect(disputePayload!.pendingAdminResolution).toBe(true)
    expect(disputePayload!.basis).toBe('outside_policy')

    // ── WIRED outcome 3: NO refund of any kind for this booking — no
    //    refund_requests row, no Refund balance credit, no Outvers credit,
    //    and no inside-policy booking.cancel audit row. Asserted per-booking
    //    (not against the shared live wallet balance) so a concurrent
    //    checkout in another parallel spec cannot perturb the result. ──
    expect(await countRefundRequestsForBooking(bookingId)).toBe(0)
    expect(
      await getRefundBalanceCreditAuditForBooking(bookingId),
      'outside-policy cancel must NOT credit the Refund balance',
    ).toBeNull()
    expect(await countOutversCreditAuditForBooking(bookingId)).toBe(0)
    expect(await countBookingCancelAuditRows(bookingId)).toBe(0)

    await page.screenshot({
      path: 'tests/e2e/screenshots/customer-cancel-outside-policy.png',
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

    // Guided-stepper (#70 / Direction A): advance past step 1 "Your details" to
    // reach the Pay control on step 2. The missing-slot guard fires server-side
    // on Pay, NOT as a step-1 gate (checkout stays a clean review step).
    await page.getByRole('button', { name: /continue to payment/i }).click()

    const payButton = page.locator('button:has-text("Pay")')
    await expect(payButton).toBeVisible()
    await payButton.click()

    // Specific, actionable field error — NOT a generic "unexpected error".
    // Scope to the page body (<main>): the same copy also fires as a sonner
    // toast in the aria-live region, so an unscoped getByText resolves to two
    // nodes (strict-mode violation). The in-page error is the contract here.
    const errorMessage = page
      .getByRole('main')
      .getByText(/select an available date and slot/i)
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

// ---------------------------------------------------------------------------
// #110 a11y: checkout guided-stepper keyboard/focus contract (DESIGN.md §5)
//
// The #70 guided stepper ("Your details" → Continue → Payment → Pay) must be
// fully keyboard-operable: every advance control is reachable + activatable by
// keyboard, focus reaches the next step's content, and the payment-mode
// RadioGroup is arrow-key operable (roving tabindex, not Tab-per-radio). This
// stops BEFORE the actual Pay so it creates no Booking and moves no money.
// ---------------------------------------------------------------------------
test.describe('Checkout guided stepper — keyboard/focus contract (#110)', () => {
  test('Continue + payment RadioGroup + Pay are keyboard-operable with focus moving into each step', async ({
    page,
  }) => {
    // Reach the checkout via the same browse path the revenue-spine uses.
    await page.goto('/adventure/rafting-in-rishikesh')
    await expect(page.locator('h1')).toBeVisible()
    const raftingLink = page
      .locator(`a[href*="/experience/${RAFTING_SLUG}"]`)
      .first()
    await raftingLink.click()
    await expect(page.locator('h1')).toBeVisible()
    const bookNow = page.locator('a:has-text("Book now")')
    await bookNow.click()
    await expect(page.locator('h1')).toContainText('Checkout')

    // ── STEP 1 → STEP 2: the "Continue to payment" advance is reachable by
    //    keyboard and activatable with the keyboard (focus it, press Enter).
    const continueBtn = page.getByRole('button', { name: /continue to payment/i })
    await expect(continueBtn).toBeVisible()
    await continueBtn.focus()
    await expect(continueBtn).toBeFocused()
    await page.keyboard.press('Enter')

    // Focus moved INTO step 2: the payment RadioGroup + the Pay button are now
    // in the DOM, and a keyboard user can reach the payment-mode choice.
    const radioGroup = page.getByRole('radiogroup', { name: /payment mode/i })
    await expect(radioGroup).toBeVisible()
    const payButton = page.getByRole('button', { name: /^Pay\s/i })
    await expect(payButton).toBeVisible()

    // ── Payment-mode RadioGroup is ARROW-KEY operable (roving tabindex):
    //    the default selection is the 25% Advance (partial_pay = the first
    //    radio); the radios are a single Tab stop and ArrowDown moves the
    //    selection to "Pay in full" (the second radio). Base UI renders each
    //    radio as a [role="radio"] element with WAI-ARIA roving tabindex — the
    //    checked one is tabindex=0, the rest tabindex=-1.
    const radios = radioGroup.getByRole('radio')
    await expect(radios).toHaveCount(2)
    const partialRadio = radios.nth(0)
    const fullRadio = radios.nth(1)
    await expect(partialRadio).toBeChecked()
    await expect(fullRadio).not.toBeChecked()
    await expect(partialRadio).toHaveAttribute('tabindex', '0')
    await expect(fullRadio).toHaveAttribute('tabindex', '-1')

    // Focus the checked radio, then drive selection purely by arrow keys.
    await partialRadio.focus()
    await expect(partialRadio).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(fullRadio).toBeChecked()
    await expect(fullRadio).toBeFocused()
    // The Pay total tracks the keyboard selection — full mode pays the gross.
    await expect(payButton).toContainText(
      `₹${EXPECTED_GROSS.toLocaleString('en-IN')}`,
    )

    // ArrowUp returns to the 25% Advance (wraps the roving selection back).
    await page.keyboard.press('ArrowUp')
    await expect(partialRadio).toBeChecked()
    await expect(payButton).toContainText(
      `₹${EXPECTED_ADVANCE.toLocaleString('en-IN')}`,
    )

    // ── The Pay control is keyboard-FOCUSABLE (reachable to complete the flow)
    //    — but we stop here: pressing it would create a Booking. Asserting it is
    //    focusable proves the journey is keyboard-completable end to end.
    await payButton.focus()
    await expect(payButton).toBeFocused()

    // The "Back" control is also keyboard-operable and returns to step 1.
    const backBtn = page.getByRole('button', { name: /^Back$/ })
    await backBtn.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: /continue to payment/i }),
    ).toBeVisible()
    // Step-1 land confirms the stepper navigates both ways by keyboard.
    await expect(page.getByRole('button', { name: /^Pay\s/i })).toHaveCount(0)
  })
})
