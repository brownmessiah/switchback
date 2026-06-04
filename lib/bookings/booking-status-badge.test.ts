import { describe, expect, it } from 'vitest'

import { bookingStatusBadge } from './booking-status-badge'
import { BOOKING_STATES } from './state-machine'

/**
 * Pure status → presentation mapper shared by the customer dashboard booking
 * cards AND the vendor bookings table (critique D — status-by-color a11y).
 *
 * The defect: Confirmed and Completed were BOTH the green `success` variant
 * with the SAME check icon, so the two states were distinguished by text label
 * alone. WCAG 1.4.1 + the critique require status to be conveyed by MORE than
 * colour — and for two states sharing a colour family, the ICON must differ so
 * they are distinguishable without reading the label.
 *
 * Returns the icon-key, a semantic Badge variant, and an i18n label-key — pure
 * over its single string input so both Server Components render its output.
 */
describe('bookingStatusBadge (D — status never by colour alone)', () => {
  it('maps confirmed to a distinct success badge', () => {
    const spec = bookingStatusBadge('confirmed')
    expect(spec.variant).toBe('success')
    expect(spec.icon).toBe('confirmed')
    expect(spec.labelKey).toBe('confirmed')
  })

  it('gives completed a DIFFERENT icon from confirmed so they are not green-on-green-with-same-icon', () => {
    // The exact a11y defect the critique flagged on the vendor table: Confirmed
    // and Completed both green + both a check icon. They must differ by icon.
    const confirmed = bookingStatusBadge('confirmed')
    const completed = bookingStatusBadge('completed')
    expect(completed.icon).not.toBe(confirmed.icon)
  })

  it('maps awaiting_completion to a warning badge with a clock', () => {
    const spec = bookingStatusBadge('awaiting_completion')
    expect(spec.variant).toBe('warning')
    expect(spec.icon).toBe('awaiting')
  })

  it('maps pending_payment to a warning badge', () => {
    expect(bookingStatusBadge('pending_payment').variant).toBe('warning')
  })

  it('maps disputed to a destructive alert badge', () => {
    const spec = bookingStatusBadge('disputed')
    expect(spec.variant).toBe('destructive')
    expect(spec.icon).toBe('alert')
  })

  it('maps every cancellation state to a destructive badge', () => {
    for (const state of [
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
    ] as const) {
      expect(bookingStatusBadge(state).variant).toBe('destructive')
    }
  })

  it('maps no_show to a destructive badge with a label-key of its own', () => {
    const spec = bookingStatusBadge('no_show')
    expect(spec.variant).toBe('destructive')
    expect(spec.labelKey).toBe('no_show')
  })

  it('returns a defensive outline fallback for an unknown state', () => {
    const spec = bookingStatusBadge('some_future_state')
    expect(spec.variant).toBe('outline')
    expect(spec.icon).toBe('info')
    // Fallback label-key echoes the raw state so the UI can still render it.
    expect(spec.labelKey).toBe('some_future_state')
  })

  it('produces a spec with a non-empty label-key for every real Booking state', () => {
    for (const state of BOOKING_STATES) {
      const spec = bookingStatusBadge(state)
      expect(spec.labelKey.length).toBeGreaterThan(0)
      expect(spec.icon.length).toBeGreaterThan(0)
    }
  })
})
