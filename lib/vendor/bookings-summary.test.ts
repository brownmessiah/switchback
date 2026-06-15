import { describe, expect, it } from 'vitest'

import { BOOKING_STATES, type BookingState } from '@/lib/bookings/state-machine'

import {
  bucketForState,
  summarizeBookings,
  type BookingDisplayBucket,
} from './bookings-summary'

describe('bookings-summary (vendor display buckets)', () => {
  describe('bucketForState — documented display-bucket mapping', () => {
    it('buckets pending_payment under "pending"', () => {
      expect(bucketForState('pending_payment')).toBe('pending')
    })

    it('buckets confirmed + awaiting_completion under "confirmed"', () => {
      expect(bucketForState('confirmed')).toBe('confirmed')
      expect(bucketForState('awaiting_completion')).toBe('confirmed')
    })

    it('buckets completed under "completed"', () => {
      expect(bucketForState('completed')).toBe('completed')
    })

    it('buckets all four cancel/no-show states under "cancelled"', () => {
      const cancelStates: readonly BookingState[] = [
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
        'no_show',
      ]
      for (const state of cancelStates) {
        expect(bucketForState(state)).toBe('cancelled')
      }
    })

    // disputed is a real enum state (ADR-0003) NOT named in the four-bucket
    // brief. Decision: map it into "confirmed" — it is a still-ACTIVE,
    // money-on-hold state (reachable from awaiting_completion, transitions on to
    // completed / cancelled_post_experience), i.e. not terminal, so it belongs
    // with the active bookings rather than any terminal bucket. Documented +
    // tested deliberately so it never silently falls through.
    it('buckets disputed under "confirmed" (still-active, not terminal)', () => {
      expect(bucketForState('disputed')).toBe('confirmed')
    })

    it('maps every BookingState enum value to exactly one valid bucket (exhaustive)', () => {
      const validBuckets: ReadonlySet<BookingDisplayBucket> = new Set([
        'pending',
        'confirmed',
        'completed',
        'cancelled',
      ])
      for (const state of BOOKING_STATES) {
        const bucket = bucketForState(state)
        expect(validBuckets.has(bucket)).toBe(true)
      }
    })
  })

  describe('summarizeBookings — aggregator', () => {
    it('returns all-zero counts for an empty list', () => {
      expect(summarizeBookings([])).toEqual({
        pending: 0,
        confirmed: 0,
        completed: 0,
        cancelled: 0,
        total: 0,
      })
    })

    it('counts each state into its display bucket', () => {
      const states: readonly BookingState[] = [
        'pending_payment',
        'confirmed',
        'awaiting_completion',
        'disputed',
        'completed',
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
        'no_show',
      ]
      expect(summarizeBookings(states)).toEqual({
        pending: 1,
        // confirmed + awaiting_completion + disputed
        confirmed: 3,
        completed: 1,
        // four cancel/no-show states
        cancelled: 4,
        total: 9,
      })
    })

    it('bucket counts always sum to total (every enum state, one each)', () => {
      const summary = summarizeBookings(BOOKING_STATES)
      expect(
        summary.pending + summary.confirmed + summary.completed + summary.cancelled,
      ).toBe(summary.total)
      expect(summary.total).toBe(BOOKING_STATES.length)
    })

    it('all cancel/no-show states land under cancelled', () => {
      const cancelStates: readonly BookingState[] = [
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
        'no_show',
      ]
      const summary = summarizeBookings(cancelStates)
      expect(summary.cancelled).toBe(4)
      expect(summary.pending).toBe(0)
      expect(summary.confirmed).toBe(0)
      expect(summary.completed).toBe(0)
      expect(summary.total).toBe(4)
    })
  })
})
