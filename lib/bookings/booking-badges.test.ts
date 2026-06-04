import { describe, expect, it } from 'vitest'

import { deriveBookingBadges } from './booking-badges'

/**
 * Pure derivation for the customer-dashboard Booking-card badges (A0 item 2a).
 *
 * The card shows AT MOST two badges: exactly ONE lifecycle badge (the Booking
 * state) and AT MOST ONE time badge ("Upcoming"). The fix the dashboard
 * critique demands: a terminal Booking (completed / cancelled / no-show /
 * disputed-resolved) must NEVER also show "Upcoming" — the two badges were
 * contradicting each other ("Completed + Upcoming", "Cancelled + Upcoming").
 *
 * Pure over its inputs (no DB, no request infra) so it is unit-testable and
 * the Server Component renders its output directly.
 */
describe('deriveBookingBadges (A0 item 2a — one lifecycle + at most one time badge)', () => {
  it('shows the Upcoming time badge for a confirmed, future Booking', () => {
    const badges = deriveBookingBadges({ state: 'confirmed', isUpcoming: true })
    expect(badges.lifecycle).toBe('confirmed')
    expect(badges.showUpcoming).toBe(true)
  })

  it('does not show Upcoming for a confirmed Booking whose slot is in the past', () => {
    const badges = deriveBookingBadges({ state: 'confirmed', isUpcoming: false })
    expect(badges.lifecycle).toBe('confirmed')
    expect(badges.showUpcoming).toBe(false)
  })

  it('suppresses Upcoming on a completed Booking even if the slot date is future', () => {
    // The exact contradiction the critique flagged: "Completed + Upcoming".
    const badges = deriveBookingBadges({ state: 'completed', isUpcoming: true })
    expect(badges.lifecycle).toBe('completed')
    expect(badges.showUpcoming).toBe(false)
  })

  it('suppresses Upcoming on a cancelled-by-customer Booking with a future slot', () => {
    // The other flagged contradiction: "Cancelled By Customer + Upcoming".
    const badges = deriveBookingBadges({
      state: 'cancelled_by_customer',
      isUpcoming: true,
    })
    expect(badges.lifecycle).toBe('cancelled_by_customer')
    expect(badges.showUpcoming).toBe(false)
  })

  it('suppresses Upcoming on every terminal state', () => {
    const terminalStates = [
      'completed',
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
      'no_show',
    ] as const
    for (const state of terminalStates) {
      const badges = deriveBookingBadges({ state, isUpcoming: true })
      expect(badges.showUpcoming, `${state} must not show Upcoming`).toBe(false)
    }
  })

  it('keeps Upcoming on a future awaiting_completion Booking (non-terminal)', () => {
    // awaiting_completion is NOT terminal — a future slot can still be upcoming.
    const badges = deriveBookingBadges({
      state: 'awaiting_completion',
      isUpcoming: true,
    })
    expect(badges.lifecycle).toBe('awaiting_completion')
    expect(badges.showUpcoming).toBe(true)
  })

  it('treats an unknown state defensively as non-terminal but still time-aware', () => {
    const future = deriveBookingBadges({ state: 'some_future_state', isUpcoming: true })
    expect(future.lifecycle).toBe('some_future_state')
    expect(future.showUpcoming).toBe(true)
    const past = deriveBookingBadges({ state: 'some_future_state', isUpcoming: false })
    expect(past.showUpcoming).toBe(false)
  })
})
