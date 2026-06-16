import { describe, expect, it } from 'vitest'

import { quoteRefund } from './refund-policy'

/**
 * Pure-function refund policy quoting per ADR-0005. The decision matrix:
 *
 *   Flexible: free up to T-24h | 50% up to T-2h | 0% after
 *   Moderate: free up to T-72h | 50% up to T-24h | 0% after
 *   Strict:   free up to T-14d | 50% up to T-7d  | 0% after
 *
 * Vendor-cancelled bookings refund 100% regardless of preset (ADR-0005
 * Vendor-cancelled Booking rule + ADR-0007 Vendor SLA hit).
 *
 * Custom presets MUST be resolved through a separate admin-pre-defined
 * table — the function throws to ensure callers never silently apply a
 * default to a Custom preset.
 *
 * Cancellation at or after start_at is outside-policy regardless of
 * preset and routes to the Dispute queue (ADR-0003).
 */
describe('quoteRefund (ADR-0005)', () => {
  const startAt = new Date('2026-09-15T10:00:00Z')

  function hoursBefore(h: number): Date {
    return new Date(startAt.getTime() - h * 3_600_000)
  }
  function daysBefore(d: number): Date {
    return hoursBefore(d * 24)
  }

  describe('flexible preset', () => {
    it('refunds 100% in the free window (>= T-24h)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(48),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(3000)
      expect(r.cancellationFeeRupees).toBe(0)
      expect(r.basis).toBe('free_window')
      expect(r.routesToDispute).toBe(false)
    })

    it('refunds 100% exactly at T-24h boundary (inclusive)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(24),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(3000)
      expect(r.basis).toBe('free_window')
    })

    it('refunds 50% in the half window (T-24h .. T-2h)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(12),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(1500)
      expect(r.cancellationFeeRupees).toBe(1500)
      expect(r.basis).toBe('50%_window')
    })

    it('refunds 50% exactly at T-2h boundary (inclusive)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(2),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(1500)
      expect(r.basis).toBe('50%_window')
    })

    it('refunds 0% in the no-refund window (< T-2h, >= T-0)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(1),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(3000)
      expect(r.basis).toBe('no_refund_window')
      expect(r.routesToDispute).toBe(false)
    })

    it('floors odd-amount 50% refunds (no half-rupee outputs)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(12),
        bookingTotalRupees: 3333,
      })
      expect(r.refundAmountRupees).toBe(1666)
      expect(r.cancellationFeeRupees).toBe(1667)
    })
  })

  describe('moderate preset', () => {
    it('refunds 100% at T-72h boundary (inclusive)', () => {
      const r = quoteRefund({
        preset: 'moderate',
        startAt,
        cancellationAt: hoursBefore(72),
        bookingTotalRupees: 5000,
      })
      expect(r.refundAmountRupees).toBe(5000)
      expect(r.basis).toBe('free_window')
    })

    it('refunds 50% at T-24h boundary on moderate (inclusive)', () => {
      const r = quoteRefund({
        preset: 'moderate',
        startAt,
        cancellationAt: hoursBefore(24),
        bookingTotalRupees: 5000,
      })
      expect(r.refundAmountRupees).toBe(2500)
      expect(r.basis).toBe('50%_window')
    })

    it('refunds 0% below T-24h on moderate', () => {
      const r = quoteRefund({
        preset: 'moderate',
        startAt,
        cancellationAt: hoursBefore(12),
        bookingTotalRupees: 5000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.basis).toBe('no_refund_window')
    })
  })

  describe('strict preset', () => {
    it('refunds 100% at T-14d boundary (inclusive)', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: daysBefore(14),
        bookingTotalRupees: 20000,
      })
      expect(r.refundAmountRupees).toBe(20000)
      expect(r.basis).toBe('free_window')
    })

    it('refunds 50% at T-7d boundary (inclusive)', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: daysBefore(7),
        bookingTotalRupees: 20000,
      })
      expect(r.refundAmountRupees).toBe(10000)
      expect(r.basis).toBe('50%_window')
    })

    it('refunds 0% below T-7d on strict', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: daysBefore(6),
        bookingTotalRupees: 20000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.basis).toBe('no_refund_window')
    })
  })

  describe('vendor cancellation override', () => {
    it('refunds 100% regardless of preset when vendorCancelled', () => {
      for (const preset of ['flexible', 'moderate', 'strict'] as const) {
        const r = quoteRefund({
          preset,
          startAt,
          cancellationAt: hoursBefore(1),
          bookingTotalRupees: 3000,
          vendorCancelled: true,
        })
        expect(r.refundAmountRupees).toBe(3000)
        expect(r.cancellationFeeRupees).toBe(0)
        expect(r.basis).toBe('vendor_cancelled')
        expect(r.routesToDispute).toBe(false)
      }
    })

    it('refunds 100% even past start_at when vendorCancelled', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: new Date(startAt.getTime() + 3_600_000),
        bookingTotalRupees: 3000,
        vendorCancelled: true,
      })
      expect(r.refundAmountRupees).toBe(3000)
      expect(r.basis).toBe('vendor_cancelled')
    })
  })

  describe('outside-policy cancellation (cancellationAt >= startAt)', () => {
    it('routes to Dispute with 0% refund regardless of preset', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: new Date(startAt.getTime() + 1),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(3000)
      expect(r.basis).toBe('outside_policy')
      expect(r.routesToDispute).toBe(true)
    })

    it('routes to Dispute when cancellationAt exactly equals startAt', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: startAt,
        bookingTotalRupees: 3000,
      })
      expect(r.basis).toBe('outside_policy')
      expect(r.routesToDispute).toBe(true)
    })

    // Matrix gap-fill (#33): the outside-policy → Dispute route must hold for
    // every preset, not just Flexible. cancellationAt >= startAt short-circuits
    // before the preset window table is consulted, so Moderate and Strict must
    // route identically (0% refund, full fee held, routesToDispute=true).
    it('routes to Dispute past start_at on Moderate', () => {
      const r = quoteRefund({
        preset: 'moderate',
        startAt,
        cancellationAt: new Date(startAt.getTime() + 3_600_000),
        bookingTotalRupees: 5000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(5000)
      expect(r.basis).toBe('outside_policy')
      expect(r.routesToDispute).toBe(true)
    })

    it('routes to Dispute past start_at on Strict', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: new Date(startAt.getTime() + 3_600_000),
        bookingTotalRupees: 20000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(20000)
      expect(r.basis).toBe('outside_policy')
      expect(r.routesToDispute).toBe(true)
    })
  })

  describe('custom preset', () => {
    it('throws — Custom presets must be resolved through admin-defined refund table', () => {
      expect(() =>
        quoteRefund({
          preset: 'custom',
          startAt,
          cancellationAt: hoursBefore(48),
          bookingTotalRupees: 3000,
        }),
      ).toThrow(/custom/i)
    })

    // Matrix gap-fill (#33): Custom has NO preset window table row — its
    // behaviour is bespoke (admin-defined table, not yet shipped). The
    // implemented behaviour is to throw *unconditionally*, independent of
    // cancellation timing. Assert that the throw is timing-independent so a
    // future "Custom inside the free window auto-refunds via the default
    // table" regression cannot silently slip in: it must stay an explicit
    // throw until the admin table lands.
    it('throws inside what would be the free window (timing-independent)', () => {
      expect(() =>
        quoteRefund({
          preset: 'custom',
          startAt,
          cancellationAt: hoursBefore(1),
          bookingTotalRupees: 3000,
        }),
      ).toThrow(/custom/i)
    })

    it('throws even when cancellationAt is past start_at (not routed to Dispute)', () => {
      expect(() =>
        quoteRefund({
          preset: 'custom',
          startAt,
          cancellationAt: new Date(startAt.getTime() + 3_600_000),
          bookingTotalRupees: 3000,
        }),
      ).toThrow(/custom/i)
    })

    it('throws even when vendorCancelled is true (preset guard precedes any branch)', () => {
      expect(() =>
        quoteRefund({
          preset: 'custom',
          startAt,
          cancellationAt: hoursBefore(48),
          bookingTotalRupees: 3000,
          vendorCancelled: true,
        }),
      ).toThrow(/custom/i)
    })
  })

  // ── non_cancellable preset (ADR-0005 revision 2026-06-16, issue #09) ──
  //
  // The fourth named preset. Its refund function ALWAYS returns 0 — there is no
  // window in which any refund is owed. A Customer cancellation attempt behaves
  // like an outside-policy case: basis 'non_cancellable', full fee held, routes
  // to the Dispute queue (ADR-0003). The vendorCancelled invariant still wins
  // first — a Vendor-cancelled non_cancellable Booking is still full-refunded.
  describe('non_cancellable preset', () => {
    it('refunds 0 far before start (where flexible/moderate/strict would all be in the free window)', () => {
      const r = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: daysBefore(30),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(3000)
      expect(r.basis).toBe('non_cancellable')
      expect(r.routesToDispute).toBe(true)
    })

    it('refunds 0 just before start', () => {
      const r = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: hoursBefore(1),
        bookingTotalRupees: 3000,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(3000)
      expect(r.basis).toBe('non_cancellable')
      expect(r.routesToDispute).toBe(true)
    })

    it('refunds 0 inside every window where flexible/moderate/strict WOULD refund', () => {
      // These are timestamps that yield a non-zero refund under at least one of
      // the three windowed presets — prove non_cancellable is 0 at all of them.
      const provingTimestamps = [
        daysBefore(20), // strict free window (>= T-14d)
        daysBefore(10), // strict 50% window (>= T-7d)
        hoursBefore(72), // moderate free window (>= T-72h)
        hoursBefore(48), // moderate 50% window (>= T-24h) / flexible 50%
        hoursBefore(24), // flexible free window (>= T-24h) / moderate 50% boundary
        hoursBefore(12), // flexible 50% window (>= T-2h)
        hoursBefore(2), // flexible 50% boundary (inclusive)
      ]
      for (const cancellationAt of provingTimestamps) {
        const r = quoteRefund({
          preset: 'non_cancellable',
          startAt,
          cancellationAt,
          bookingTotalRupees: 5000,
        })
        expect(r.refundAmountRupees).toBe(0)
        expect(r.cancellationFeeRupees).toBe(5000)
        expect(r.basis).toBe('non_cancellable')
        expect(r.routesToDispute).toBe(true)
      }
    })

    it('refunds 0 even on a zero-total (free) booking with basis non_cancellable', () => {
      const r = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: daysBefore(30),
        bookingTotalRupees: 0,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(0)
      expect(r.basis).toBe('non_cancellable')
      expect(r.routesToDispute).toBe(true)
    })

    it('still full-refunds when the VENDOR cancels (vendorCancelled wins before the preset)', () => {
      const r = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: hoursBefore(1),
        bookingTotalRupees: 3000,
        vendorCancelled: true,
      })
      expect(r.refundAmountRupees).toBe(3000)
      expect(r.cancellationFeeRupees).toBe(0)
      expect(r.basis).toBe('vendor_cancelled')
      expect(r.routesToDispute).toBe(false)
    })

    it('still full-refunds when the VENDOR cancels past start_at', () => {
      const r = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: new Date(startAt.getTime() + 3_600_000),
        bookingTotalRupees: 3000,
        vendorCancelled: true,
      })
      expect(r.refundAmountRupees).toBe(3000)
      expect(r.basis).toBe('vendor_cancelled')
    })
  })

  // ── reschedule_allowed echoed on the quote (ADR-0005 revision, issue #09) ──
  //
  // The flag is a property carried ALONGSIDE the refund math, not an input to
  // it. quoteRefund echoes whatever it is given (defaulting false), so issue 10
  // can read "reschedule allowed" from the same place as the refund figure.
  describe('rescheduleAllowed echo', () => {
    it('defaults rescheduleAllowed to false when not supplied', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(48),
        bookingTotalRupees: 3000,
      })
      expect(r.rescheduleAllowed).toBe(false)
    })

    it('echoes rescheduleAllowed=true unchanged across all four presets without altering the refund math', () => {
      // Flexible free window (refund 3000), unaffected by the flag.
      const flex = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(48),
        bookingTotalRupees: 3000,
        rescheduleAllowed: true,
      })
      expect(flex.rescheduleAllowed).toBe(true)
      expect(flex.refundAmountRupees).toBe(3000)
      expect(flex.basis).toBe('free_window')

      // non_cancellable still 0 — the flag is orthogonal to the refund amount.
      const nonCancellable = quoteRefund({
        preset: 'non_cancellable',
        startAt,
        cancellationAt: daysBefore(30),
        bookingTotalRupees: 3000,
        rescheduleAllowed: true,
      })
      expect(nonCancellable.rescheduleAllowed).toBe(true)
      expect(nonCancellable.refundAmountRupees).toBe(0)
      expect(nonCancellable.basis).toBe('non_cancellable')
    })

    it('echoes rescheduleAllowed=false explicitly', () => {
      const r = quoteRefund({
        preset: 'strict',
        startAt,
        cancellationAt: daysBefore(20),
        bookingTotalRupees: 20000,
        rescheduleAllowed: false,
      })
      expect(r.rescheduleAllowed).toBe(false)
    })

    it('echoes rescheduleAllowed on the vendor-cancelled branch', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(1),
        bookingTotalRupees: 3000,
        vendorCancelled: true,
        rescheduleAllowed: true,
      })
      expect(r.rescheduleAllowed).toBe(true)
      expect(r.basis).toBe('vendor_cancelled')
    })
  })

  describe('invalid input', () => {
    it('rejects negative bookingTotalRupees', () => {
      expect(() =>
        quoteRefund({
          preset: 'flexible',
          startAt,
          cancellationAt: hoursBefore(48),
          bookingTotalRupees: -1,
        }),
      ).toThrow(/non-negative/i)
    })

    it('refunds 0 on zero bookingTotalRupees (free booking edge)', () => {
      const r = quoteRefund({
        preset: 'flexible',
        startAt,
        cancellationAt: hoursBefore(48),
        bookingTotalRupees: 0,
      })
      expect(r.refundAmountRupees).toBe(0)
      expect(r.cancellationFeeRupees).toBe(0)
      expect(r.basis).toBe('free_window')
    })
  })
})
