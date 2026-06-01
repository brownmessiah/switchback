import { describe, expect, it } from 'vitest'

import { getConfirmationPresentation } from './booking-presentation'

// The booking_state enum (db/schema/bookings.ts). Every value must map to a
// coherent presentation — headline, body clause, icon, tone must AGREE.
const ALL_STATES = [
  'pending_payment',
  'confirmed',
  'awaiting_completion',
  'completed',
  'disputed',
  'cancelled_by_customer',
  'cancelled_by_vendor',
  'cancelled_post_experience',
  'no_show',
] as const

describe('getConfirmationPresentation', () => {
  it('shows the success headline + body + success tone ONLY for confirmed/paid states', () => {
    for (const state of ['confirmed', 'awaiting_completion', 'completed']) {
      const p = getConfirmationPresentation(state)
      expect(p.headline).toBe('Booking confirmed')
      expect(p.bodyClause).toBe('is confirmed.')
      expect(p.tone).toBe('success')
    }
  })

  it('uses the success tone for NO state other than confirmed/paid', () => {
    const settled = new Set(['confirmed', 'awaiting_completion', 'completed'])
    for (const state of ALL_STATES) {
      if (settled.has(state)) continue
      expect(
        getConfirmationPresentation(state).tone,
        `${state} must not use the success tone`,
      ).not.toBe('success')
    }
  })

  it('shows a non-success "cancelled" presentation for every cancelled_* state', () => {
    for (const state of [
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
    ]) {
      const p = getConfirmationPresentation(state)
      expect(p.headline).toBe('Booking cancelled')
      expect(p.bodyClause).toBe('has been cancelled.')
      expect(p.tone).toBe('muted')
    }
  })

  it('shows an "Under review" warning presentation for a disputed booking', () => {
    const p = getConfirmationPresentation('disputed')
    expect(p.headline).toBe('Under review')
    expect(p.bodyClause).toBe('is under review.')
    expect(p.tone).toBe('warning')
  })

  it('shows a "Payment pending" warning for a pending_payment booking (never a success check)', () => {
    const p = getConfirmationPresentation('pending_payment')
    expect(p.headline).toBe('Payment pending')
    expect(p.bodyClause).toBe('is awaiting payment.')
    expect(p.tone).toBe('warning')
    expect(p.icon).not.toBe('check')
  })

  it('shows a muted "no-show" presentation for a no_show booking', () => {
    const p = getConfirmationPresentation('no_show')
    expect(p.headline).toBe('Marked as no-show')
    expect(p.bodyClause).toBe('was marked as a no-show.')
    expect(p.tone).toBe('muted')
  })

  it('falls back to a safe neutral presentation for an unknown state', () => {
    const p = getConfirmationPresentation('some_future_state')
    expect(p.tone).toBe('muted')
    expect(p.headline.length).toBeGreaterThan(0)
    expect(p.bodyClause.length).toBeGreaterThan(0)
  })

  it('headline, body, and tone always agree (no contradictory combination)', () => {
    // A success tone implies the confirmed headline+body, and vice versa —
    // the exact contradiction the redesign must not reintroduce.
    for (const state of [...ALL_STATES, 'unknown_state']) {
      const p = getConfirmationPresentation(state)
      const isSuccess = p.tone === 'success'
      const isConfirmedCopy =
        p.headline === 'Booking confirmed' && p.bodyClause === 'is confirmed.'
      expect(isSuccess).toBe(isConfirmedCopy)
    }
  })
})
