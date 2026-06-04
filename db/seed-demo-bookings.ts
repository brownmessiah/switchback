/**
 * Pure placement rule for the demo customer's seeded bookings (residual fix
 * from docs/plans/post-milestone-visual-critique-fix-plan.md, "Status —
 * 2026-06-04").
 *
 * A TERMINAL booking (completed / cancelled_*) must always sit on a PAST
 * availability slot — a "Completed" trip dated in the near future reads as
 * broken on the customer dashboard and sorts among upcoming. Only live states
 * (confirmed / awaiting_completion) may sit on a future slot.
 *
 * Keeping the rule pure lets the seed (db/seed.ts — not unit-testable, it
 * auto-runs an orchestrator) delegate slot placement to a function we CAN test,
 * so a review-generation path that naively reuses a future slot for a completed
 * booking is corrected at the source.
 */

/** Booking states that are terminal — the trip is over (or never happened). */
export type TerminalLikeBookingState =
  | 'completed'
  | 'cancelled_by_customer'
  | 'cancelled_by_vendor'
  | 'cancelled_post_experience'

/** True when the booking state is terminal (must live on a past slot). */
export function isTerminalBookingState(state: string): boolean {
  return state === 'completed' || state.startsWith('cancelled')
}

/**
 * Resolve the slot offset (in days from now) for a demo booking, enforcing the
 * invariant: terminal → past, live → keeps its requested offset.
 *
 * - `requestedOffsetDays` is the seed author's intent (e.g. -21 for a trip
 *   three weeks ago, +7 for an upcoming confirmed trip).
 * - A terminal state with a non-negative (future/now) requested offset is
 *   coerced to its absolute value in the past (so a review-generation path
 *   asking for +7 lands at -7).
 * - 0 is never returned for either branch ("now" is ambiguous on the dashboard).
 */
export function resolveDemoBookingSlotOffsetDays(
  state: string,
  requestedOffsetDays: number,
): number {
  if (isTerminalBookingState(state)) {
    if (requestedOffsetDays < 0) return requestedOffsetDays
    // Coerce future/now to a deterministic past offset.
    return requestedOffsetDays === 0 ? -1 : -Math.abs(requestedOffsetDays)
  }
  // Non-terminal: keep the requested offset, but never exactly 0.
  return requestedOffsetDays === 0 ? 1 : requestedOffsetDays
}
