/**
 * Unit tests for the demo-customer booking slot resolver (residual fix from
 * docs/plans/post-milestone-visual-critique-fix-plan.md "Status — 2026-06-04").
 *
 * The customer dashboard was showing a "Completed" card dated in the NEAR
 * FUTURE because some terminal (completed / cancelled_*) bookings for the demo
 * customer sat on FUTURE availability slots (the review-generation paths reused
 * the T+7d demo slots). `resolveDemoBookingSlotOffset` is the pure rule the
 * seed uses to place each demo booking's slot:
 *
 *   - every TERMINAL booking (completed / cancelled_*) → a PAST slot,
 *   - only non-terminal (confirmed / awaiting_completion) → a future slot.
 *
 * Locking it as a pure function lets us assert the invariant the seed relies on
 * without running the full (non-unit-testable) db/seed.ts orchestrator.
 */
import { describe, expect, it } from 'vitest'

import {
  isTerminalBookingState,
  resolveDemoBookingSlotOffsetDays,
} from './seed-demo-bookings'

describe('isTerminalBookingState', () => {
  it('treats completed + every cancelled_* state as terminal', () => {
    expect(isTerminalBookingState('completed')).toBe(true)
    expect(isTerminalBookingState('cancelled_by_customer')).toBe(true)
    expect(isTerminalBookingState('cancelled_by_vendor')).toBe(true)
    expect(isTerminalBookingState('cancelled_post_experience')).toBe(true)
  })

  it('treats live states as non-terminal', () => {
    expect(isTerminalBookingState('confirmed')).toBe(false)
    expect(isTerminalBookingState('awaiting_completion')).toBe(false)
    expect(isTerminalBookingState('disputed')).toBe(false)
  })
})

describe('resolveDemoBookingSlotOffsetDays — terminal bookings always land in the past', () => {
  it('forces a NEGATIVE (past) offset for every terminal booking, even if a future offset is requested', () => {
    // A review-generation path that naively asked for a future slot (+7) on a
    // completed booking must be coerced to the past.
    expect(resolveDemoBookingSlotOffsetDays('completed', 7)).toBeLessThan(0)
    expect(resolveDemoBookingSlotOffsetDays('cancelled_by_customer', 12)).toBeLessThan(0)
  })

  it('preserves an already-past offset for terminal bookings', () => {
    expect(resolveDemoBookingSlotOffsetDays('completed', -21)).toBe(-21)
    expect(resolveDemoBookingSlotOffsetDays('cancelled_by_customer', -14)).toBe(-14)
  })

  it('preserves a future offset for non-terminal (confirmed) bookings', () => {
    expect(resolveDemoBookingSlotOffsetDays('confirmed', 7)).toBe(7)
    expect(resolveDemoBookingSlotOffsetDays('awaiting_completion', -2)).toBe(-2)
  })

  it('never returns 0 (a slot dated exactly "now" reads ambiguously)', () => {
    expect(resolveDemoBookingSlotOffsetDays('completed', 0)).not.toBe(0)
    expect(resolveDemoBookingSlotOffsetDays('confirmed', 0)).not.toBe(0)
  })
})
