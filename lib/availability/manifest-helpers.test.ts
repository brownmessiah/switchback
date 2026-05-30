import { describe, expect, it } from 'vitest'

import {
  bracketLabel,
  classifySlotStatus,
  computeBalanceDueRupees,
  type SlotStatusInput,
} from './manifest-helpers'

// ── classifySlotStatus ──────────────────────────────────────────────
//
// Extends the persisted slot status with a derived `likely-sell-out`
// bucket (DESIGN.md / #78 variant A in-grid status). The four buckets are
// computed from the REAL slot capacity/capacityTaken/closure facts:
//   - closure present OR slot.status === 'closed'        → 'closed'
//   - capacityTaken >= capacity                          → 'sold-out'
//   - near capacity (remaining small AND taken > 0)      → 'likely-sell-out'
//   - otherwise                                          → 'open'

function slot(partial: Partial<SlotStatusInput>): SlotStatusInput {
  return {
    capacity: 10,
    capacityTaken: 0,
    status: 'open',
    ...partial,
  }
}

describe('classifySlotStatus', () => {
  it('returns closed when a region closure covers the slot', () => {
    expect(classifySlotStatus(slot({ capacityTaken: 3 }), true)).toBe('closed')
  })

  it('returns closed when the persisted slot status is closed (blocked date)', () => {
    expect(classifySlotStatus(slot({ status: 'closed', capacityTaken: 2 }), false)).toBe(
      'closed',
    )
  })

  it('returns sold-out when capacityTaken meets capacity', () => {
    expect(classifySlotStatus(slot({ capacity: 8, capacityTaken: 8 }), false)).toBe('sold-out')
  })

  it('returns sold-out when capacityTaken exceeds capacity (defensive)', () => {
    expect(classifySlotStatus(slot({ capacity: 8, capacityTaken: 9 }), false)).toBe('sold-out')
  })

  it('returns likely-sell-out when near capacity with at least one taken', () => {
    // capacity 10, taken 8 → 2 remaining (≤ 20% of capacity, taken > 0)
    expect(classifySlotStatus(slot({ capacity: 10, capacityTaken: 8 }), false)).toBe(
      'likely-sell-out',
    )
  })

  it('returns open when there are bookings but capacity is comfortable', () => {
    // capacity 10, taken 3 → 7 remaining → still open
    expect(classifySlotStatus(slot({ capacity: 10, capacityTaken: 3 }), false)).toBe('open')
  })

  it('returns open when empty (no bookings)', () => {
    expect(classifySlotStatus(slot({ capacity: 10, capacityTaken: 0 }), false)).toBe('open')
  })

  it('does not flag likely-sell-out when nearly-full but zero taken (defensive)', () => {
    // taken 0 → never "likely to sell out"; only near-capacity WITH demand counts
    expect(classifySlotStatus(slot({ capacity: 1, capacityTaken: 0 }), false)).toBe('open')
  })

  it('closure takes precedence over a sold-out slot', () => {
    expect(classifySlotStatus(slot({ capacity: 5, capacityTaken: 5 }), true)).toBe('closed')
  })
})

// ── computeBalanceDueRupees ─────────────────────────────────────────
//
// Canonical Partial-pay split (ADR-0001 / lib/payments/partial-pay-autocapture):
//   advance  = floor(gross * 0.25)
//   balance  = gross - advance      (the T-24h auto-capture remainder)
// so advance + balance === gross for every rupee gross.

describe('computeBalanceDueRupees', () => {
  it('computes balance as gross minus the floor-rounded 25% advance', () => {
    // gross 4001 → advance floor(1000.25)=1000 → balance 3001
    expect(computeBalanceDueRupees(4001)).toBe(3001)
  })

  it('matches advance + balance === gross for a clean multiple of 4', () => {
    // gross 4000 → advance 1000 → balance 3000
    expect(computeBalanceDueRupees(4000)).toBe(3000)
  })

  it('handles a gross that floors the advance down', () => {
    // gross 100 → advance floor(25)=25 → balance 75
    expect(computeBalanceDueRupees(100)).toBe(75)
  })

  it('returns 0 for a zero gross', () => {
    expect(computeBalanceDueRupees(0)).toBe(0)
  })

  it('rounds the advance down so the balance carries the remainder', () => {
    // gross 7 → advance floor(1.75)=1 → balance 6
    expect(computeBalanceDueRupees(7)).toBe(6)
  })
})

// ── bracketLabel ────────────────────────────────────────────────────
//
// Group-size bracket fires from participantCount (ADR-0011: 1-2 / 3-5 / 6+),
// matching lib/payments/pricing-resolver basis arms.

describe('bracketLabel', () => {
  it('labels 1 and 2 participants as the 1-2 bracket', () => {
    expect(bracketLabel(1)).toBe('1-2')
    expect(bracketLabel(2)).toBe('1-2')
  })

  it('labels 3 to 5 participants as the 3-5 bracket', () => {
    expect(bracketLabel(3)).toBe('3-5')
    expect(bracketLabel(5)).toBe('3-5')
  })

  it('labels 6 or more participants as the 6+ bracket', () => {
    expect(bracketLabel(6)).toBe('6+')
    expect(bracketLabel(12)).toBe('6+')
  })
})
