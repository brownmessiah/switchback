/**
 * Pure derivation for the customer-dashboard Booking-card badges (A0 item 2a).
 *
 * A Booking card shows AT MOST two badges:
 *   1. exactly ONE lifecycle badge — the Booking state (Confirmed / Completed /
 *      Cancelled / …);
 *   2. AT MOST ONE time badge — "Upcoming" — derived from the slot date.
 *
 * The customer-dashboard critique flagged contradictory pairs: "Completed +
 * Upcoming" and "Cancelled + Upcoming". The fix is to suppress the time badge
 * on TERMINAL lifecycle states — a Booking that is done (completed) or dead
 * (cancelled / no-show) can never be "Upcoming", regardless of its slot date.
 *
 * Pure over its inputs (no DB, no Next.js request infrastructure) so it is
 * unit-testable in isolation and the Server Component renders its output
 * directly.
 */

import { BOOKING_TRANSITIONS, type BookingState } from './state-machine'

export interface BookingBadgeArgs {
  /** The Booking lifecycle state (schema enum value). */
  state: string
  /** Whether the booked slot's start is in the future (time badge driver). */
  isUpcoming: boolean
}

export interface BookingBadges {
  /** The single lifecycle badge — always the raw state for the card to map. */
  lifecycle: string
  /** Whether to render the "Upcoming" time badge (never on terminal states). */
  showUpcoming: boolean
}

/**
 * A terminal state has no outgoing transitions (state-machine.ts is the single
 * source of truth). Unknown states are treated defensively as NON-terminal so a
 * future schema state still gets a time badge rather than being silently hidden.
 */
function isTerminal(state: string): boolean {
  const transitions = BOOKING_TRANSITIONS[state as BookingState]
  return Array.isArray(transitions) && transitions.length === 0
}

/**
 * Derive the one lifecycle badge + at-most-one time badge for a Booking card.
 * The "Upcoming" time badge shows ONLY when the Booking is non-terminal AND its
 * slot is in the future.
 */
export function deriveBookingBadges(args: BookingBadgeArgs): BookingBadges {
  return {
    lifecycle: args.state,
    showUpcoming: args.isUpcoming && !isTerminal(args.state),
  }
}
