import { describe, expect, it } from 'vitest'

import {
  BOOKING_STATES,
  BOOKING_TRANSITIONS,
  canTransition,
  isCustomerCancellableState,
  isNoShowMarkableState,
  isTerminalState,
  isVendorCancellableState,
  isVendorPayoutEligibleState,
  type BookingState,
} from './state-machine'

describe('booking state machine (ADR-0003 + revision 2026-06-01)', () => {
  it('enumerates all nine states, including pending_payment + no_show', () => {
    expect([...BOOKING_STATES].sort()).toEqual(
      [
        'awaiting_completion',
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
        'completed',
        'confirmed',
        'disputed',
        'no_show',
        'pending_payment',
      ].sort(),
    )
  })

  it('every state has a transition entry (no undefined edges)', () => {
    for (const s of BOOKING_STATES) {
      expect(BOOKING_TRANSITIONS[s]).toBeDefined()
    }
  })

  it('transition targets are themselves valid states (no typos)', () => {
    const valid = new Set<string>(BOOKING_STATES)
    for (const s of BOOKING_STATES) {
      for (const target of BOOKING_TRANSITIONS[s]) {
        expect(valid.has(target)).toBe(true)
      }
    }
  })

  describe('pending_payment (pre-confirmation)', () => {
    it('confirms on capture or cancels on dismissal/timeout', () => {
      expect(canTransition('pending_payment', 'confirmed')).toBe(true)
      expect(canTransition('pending_payment', 'cancelled_by_customer')).toBe(true)
      expect(canTransition('pending_payment', 'cancelled_by_vendor')).toBe(true)
    })
    it('cannot jump straight to completed/awaiting/no_show', () => {
      expect(canTransition('pending_payment', 'completed')).toBe(false)
      expect(canTransition('pending_payment', 'awaiting_completion')).toBe(false)
      expect(canTransition('pending_payment', 'no_show')).toBe(false)
    })
    it('is neither payout- nor customer-refund-eligible (no money captured)', () => {
      expect(isVendorPayoutEligibleState('pending_payment')).toBe(false)
      expect(isCustomerCancellableState('pending_payment')).toBe(false)
    })
  })

  describe('no_show (terminal)', () => {
    it('is reachable only from confirmed or awaiting_completion', () => {
      expect(canTransition('confirmed', 'no_show')).toBe(true)
      expect(canTransition('awaiting_completion', 'no_show')).toBe(true)
      expect(isNoShowMarkableState('confirmed')).toBe(true)
      expect(isNoShowMarkableState('awaiting_completion')).toBe(true)
      expect(isNoShowMarkableState('completed')).toBe(false)
      expect(isNoShowMarkableState('pending_payment')).toBe(false)
    })
    it('is terminal — no outgoing transitions', () => {
      expect(BOOKING_TRANSITIONS.no_show).toEqual([])
      expect(isTerminalState('no_show')).toBe(true)
    })
    it('yields no customer refund and no payout (customer at fault, no completion)', () => {
      expect(isCustomerCancellableState('no_show')).toBe(false)
      expect(isVendorPayoutEligibleState('no_show')).toBe(false)
    })
  })

  describe('existing guards stay intact', () => {
    it('only confirmed is customer-cancellable (matches refund-flow CANCELLABLE_STATES)', () => {
      const cancellable = BOOKING_STATES.filter((s) => isCustomerCancellableState(s))
      expect(cancellable).toEqual(['confirmed'])
    })
    it('confirmed + awaiting_completion are vendor-cancellable', () => {
      const vc = BOOKING_STATES.filter((s) => isVendorCancellableState(s))
      expect([...vc].sort()).toEqual(['awaiting_completion', 'confirmed'])
    })
    it('only completed is payout-eligible (payout gates on completedAt)', () => {
      const payable = BOOKING_STATES.filter((s) => isVendorPayoutEligibleState(s))
      expect(payable).toEqual(['completed'])
    })
    it('terminal states have no outgoing edges', () => {
      const terminal: BookingState[] = [
        'completed',
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
        'no_show',
      ]
      for (const s of terminal) {
        expect(isTerminalState(s)).toBe(true)
        expect(BOOKING_TRANSITIONS[s]).toEqual([])
      }
    })
    it('preserves the ADR-0003 happy path confirmed → awaiting_completion → completed', () => {
      expect(canTransition('confirmed', 'awaiting_completion')).toBe(true)
      expect(canTransition('awaiting_completion', 'completed')).toBe(true)
      expect(canTransition('awaiting_completion', 'disputed')).toBe(true)
      expect(canTransition('disputed', 'completed')).toBe(true)
      expect(canTransition('disputed', 'cancelled_post_experience')).toBe(true)
    })
  })
})
