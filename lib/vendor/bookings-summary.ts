/**
 * Pure Booking-state → vendor display-bucket mapper for the `/vendor/bookings`
 * declutter (issue 02). The vendor bookings surface presents Bookings under
 * FOUR display statuses; this module is the single documented reference for the
 * lifecycle-state → display-bucket projection and the count aggregator behind
 * the page's four summary cards and status tabs.
 *
 * Display-bucket mapping (the one canonical place it is documented):
 *   pending    ← pending_payment
 *   confirmed  ← confirmed, awaiting_completion, disputed
 *   completed  ← completed
 *   cancelled  ← cancelled_by_customer, cancelled_by_vendor,
 *                cancelled_post_experience, no_show
 *
 * `disputed` is a real enum state (ADR-0003) NOT named in the four-bucket brief.
 * It is mapped into `confirmed` deliberately: it is a still-ACTIVE,
 * money-on-hold conflict (reachable from `awaiting_completion`, transitions on
 * to `completed` / `cancelled_post_experience`) — i.e. NOT terminal — so it
 * belongs with the active bookings rather than any terminal bucket. The unit
 * tests assert this so it never silently falls through.
 *
 * No instant-confirmation change: "pending" is `pending_payment` ONLY — there
 * is no Accept/Reject approval flow.
 */

import { type BookingState } from '@/lib/bookings/state-machine'

/** The four display statuses the vendor bookings page buckets Bookings into. */
export type BookingDisplayBucket = 'pending' | 'confirmed' | 'completed' | 'cancelled'

/**
 * Exhaustive lifecycle-state → display-bucket map. Keyed by every
 * `BookingState` enum value so a future schema state forces a compile error
 * here (Record<BookingState, …>) rather than silently falling through.
 */
const BUCKET_BY_STATE: Record<BookingState, BookingDisplayBucket> = {
  pending_payment: 'pending',
  confirmed: 'confirmed',
  awaiting_completion: 'confirmed',
  // Still-active, money-on-hold conflict — not terminal → grouped with active.
  disputed: 'confirmed',
  completed: 'completed',
  cancelled_by_customer: 'cancelled',
  cancelled_by_vendor: 'cancelled',
  cancelled_post_experience: 'cancelled',
  no_show: 'cancelled',
}

/** Project a single Booking lifecycle state onto its display bucket. */
export function bucketForState(state: BookingState): BookingDisplayBucket {
  return BUCKET_BY_STATE[state]
}

/** Per-bucket Booking counts plus the grand total — drives the summary cards. */
export interface BookingsSummary {
  pending: number
  confirmed: number
  completed: number
  cancelled: number
  total: number
}

/**
 * Aggregate a list of Booking lifecycle states into per-display-bucket counts.
 * Counts always sum to `total` (each state lands in exactly one bucket).
 */
export function summarizeBookings(
  states: readonly BookingState[],
): BookingsSummary {
  const summary: BookingsSummary = {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
    total: 0,
  }
  for (const state of states) {
    summary[bucketForState(state)] += 1
    summary.total += 1
  }
  return summary
}
