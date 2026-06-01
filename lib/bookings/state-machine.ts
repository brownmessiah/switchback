/**
 * Canonical Booking state machine (ADR-0003, revised 2026-06-01 to add
 * `pending_payment` and `no_show`; `reserved` deliberately NOT added —
 * reserve-now-pay-later is a payment_mode, not a lifecycle state).
 *
 * This module is the single documented reference for the lifecycle graph and
 * per-state money eligibility. The mutating Server Actions keep their own
 * inline guards (refund-flow, vendor-actions, admin-dispute-actions); the
 * predicates here MIRROR those guards so the two never silently diverge — the
 * test suite cross-checks them. New actions (e.g. mark-no-show) consult this
 * module directly.
 *
 * Lifecycle (— = transition; * = terminal):
 *
 *   pending_payment ── confirmed                     (Razorpay capture)
 *        │           └─ cancelled_by_customer/vendor (dismissal / timeout sweep)
 *   confirmed ── awaiting_completion                 (at slot end_at)
 *        │     ├─ cancelled_by_customer/vendor        (ADR-0005 cancellation)
 *        │     └─ no_show                             (vendor attests absence)
 *   awaiting_completion ── completed *                (vendor mark / +24h auto)
 *        │               ├─ disputed                  (customer raises issue)
 *        │               ├─ cancelled_by_vendor *
 *        │               └─ no_show *
 *   disputed ── completed *                           (support: vendor wins)
 *        │     └─ cancelled_post_experience *          (support: customer wins)
 */

import { bookingStateEnum } from '@/db/schema/bookings'

export type BookingState = (typeof bookingStateEnum.enumValues)[number]

/** All Booking states (sourced from the schema enum — single source of truth). */
export const BOOKING_STATES: readonly BookingState[] = bookingStateEnum.enumValues

/**
 * Valid outgoing transitions per state. A terminal state maps to `[]`.
 * Cancellation edges follow ADR-0005; completion edges follow ADR-0003.
 */
export const BOOKING_TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  pending_payment: ['confirmed', 'cancelled_by_customer', 'cancelled_by_vendor'],
  confirmed: [
    'awaiting_completion',
    'cancelled_by_customer',
    'cancelled_by_vendor',
    'no_show',
  ],
  awaiting_completion: [
    'completed',
    'disputed',
    'cancelled_by_vendor',
    'no_show',
  ],
  completed: [],
  disputed: ['completed', 'cancelled_post_experience'],
  cancelled_by_customer: [],
  cancelled_by_vendor: [],
  cancelled_post_experience: [],
  no_show: [],
}

/** True if `to` is a sanctioned next state from `from`. */
export function canTransition(from: BookingState, to: BookingState): boolean {
  return BOOKING_TRANSITIONS[from].includes(to)
}

/** A state with no outgoing transitions. */
export function isTerminalState(state: BookingState): boolean {
  return BOOKING_TRANSITIONS[state].length === 0
}

/**
 * States a CUSTOMER can cancel (→ refund flow). Mirrors refund-flow's
 * `CANCELLABLE_STATES` — only `confirmed`. `pending_payment` has no captured
 * money to refund; everything else is past the cancellation window or terminal.
 */
export function isCustomerCancellableState(state: BookingState): boolean {
  return state === 'confirmed'
}

/**
 * States a VENDOR can cancel. Mirrors vendor-actions' `VENDOR_CANCELLABLE_STATES`
 * — `confirmed` or `awaiting_completion`.
 */
export function isVendorCancellableState(state: BookingState): boolean {
  return state === 'confirmed' || state === 'awaiting_completion'
}

/**
 * States from which a Vendor can attest a customer no-show: the experience was
 * scheduled (confirmed) or its window has elapsed (awaiting_completion) but the
 * customer never showed. The caller additionally checks the slot end has passed.
 */
export function isNoShowMarkableState(state: BookingState): boolean {
  return state === 'confirmed' || state === 'awaiting_completion'
}

/**
 * States eligible for Vendor payout. Payout gates on `completedAt` (ADR-0016
 * payout-cycles), which only `completed` sets — so `no_show` (no completion,
 * vendor retains funds via reconciliation, not the payout countdown) and
 * `pending_payment` (no captured funds) are excluded.
 */
export function isVendorPayoutEligibleState(state: BookingState): boolean {
  return state === 'completed'
}
