import { describe, expect, it } from 'vitest'

import { destinationFingerprint } from './payout-destination'
import { type EligiblePayoutInput, planPayoutBatches } from './payout-batch-planner'

/**
 * Payout Batch planner per ADR-0016 (2026-06-18 amendment, D1+D3).
 *
 * PURE function: matured eligible Payouts (per-Booking owed money) + Vendor
 * manual-approval state → the set of Payout Batches keyed on
 * (vendor, destinationFingerprint, batchDay) with summed net / TDS / TCS.
 *
 * A Payout Batch is the unit sent to Razorpay X: ONE transfer per
 * (Vendor, destination) per daily 5pm-IST batch. A Vendor's Bookings with
 * divergent snapshotted destinations split into separate Batches.
 *
 * Eligibility (the planner filters to these):
 *   completedAt set
 *   AND matured: completedAt + payoutWindowDays(...)*86400000 ≤ now
 *   AND (payoutState='approved' OR (payoutState='pending' AND
 *        vendorManualPayoutsRemaining===0))
 *
 * Money invariant: amountNetRupees = Σ computeVendorNetPayout(...).netPayoutRupees;
 * commission + GST + TDS + TCS are RETAINED in the platform balance, never
 * summed into the transfer. tdsTotal / tcsTotal are tracked separately for
 * the 26Q / GSTR-8 trail.
 */
describe('planPayoutBatches (ADR-0016)', () => {
  const BATCH_DAY = '2026-06-18'
  // now far enough ahead that every default-window Booking below has matured.
  const NOW = new Date('2026-06-18T11:30:00.000Z')

  const VPA_A = { vpa: 'vendor-a@upi' }
  const VPA_B = { vpa: 'vendor-b@upi' }

  /**
   * A fully-eligible default-window Payout for vendor `u_v` to destination
   * VPA_A: completed 30 days ago (well past T+7), approved, ₹10,000 gross.
   * net = 10000 − 2000 (20% comm) − 360 (18% GST) − 10 (TDS) − 50 (TCS) = 7580.
   */
  function eligiblePayout(
    overrides: Partial<EligiblePayoutInput> = {},
  ): EligiblePayoutInput {
    return {
      bookingId: 'b1',
      vendorUserId: 'u_v',
      completedAt: new Date('2026-05-19T00:00:00.000Z'),
      permitRequired: false,
      multiDay: false,
      payoutState: 'approved',
      vendorManualPayoutsRemaining: 0,
      payoutMethod: 'upi',
      payoutDestinationSnapshot: VPA_A,
      grossRupees: 10000,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 10,
      tcsRupees: 50,
      ...overrides,
    }
  }

  describe('grouping by (vendor, destination)', () => {
    it('groups two approved Payouts for the same vendor+destination into ONE Batch', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ bookingId: 'b1' }),
          eligiblePayout({ bookingId: 'b2' }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })

      expect(batches).toHaveLength(1)
      const [batch] = batches
      expect(batch!.vendorUserId).toBe('u_v')
      expect(batch!.destinationFingerprint).toBe(destinationFingerprint(VPA_A))
      expect(batch!.batchDay).toBe(BATCH_DAY)
      expect(batch!.memberBookingIds.sort()).toEqual(['b1', 'b2'])
      // Σ net = 7580 + 7580
      expect(batch!.amountNetRupees).toBe(15160)
    })

    it('splits a vendor with divergent destinations into TWO Batches', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ bookingId: 'b1', payoutDestinationSnapshot: VPA_A }),
          eligiblePayout({ bookingId: 'b2', payoutDestinationSnapshot: VPA_B }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })

      expect(batches).toHaveLength(2)
      const fps = batches.map((b) => b.destinationFingerprint).sort()
      expect(fps).toEqual(
        [destinationFingerprint(VPA_A), destinationFingerprint(VPA_B)].sort(),
      )
      // Each Batch carries exactly its own Booking.
      for (const b of batches) {
        expect(b.memberBookingIds).toHaveLength(1)
        expect(b.amountNetRupees).toBe(7580)
      }
    })

    it('splits two different vendors sharing a destination shape into TWO Batches', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ bookingId: 'b1', vendorUserId: 'u_v1' }),
          eligiblePayout({ bookingId: 'b2', vendorUserId: 'u_v2' }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })

      expect(batches).toHaveLength(2)
      expect(batches.map((b) => b.vendorUserId).sort()).toEqual(['u_v1', 'u_v2'])
    })
  })

  describe('summed net / TDS / TCS', () => {
    it('sums net, tds, and tcs across the Batch members', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ bookingId: 'b1', tdsRupees: 10, tcsRupees: 50 }),
          eligiblePayout({ bookingId: 'b2', tdsRupees: 10, tcsRupees: 50 }),
          eligiblePayout({ bookingId: 'b3', tdsRupees: 10, tcsRupees: 50 }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })

      expect(batches).toHaveLength(1)
      const [batch] = batches
      expect(batch!.amountNetRupees).toBe(7580 * 3)
      expect(batch!.tdsTotal).toBe(30)
      expect(batch!.tcsTotal).toBe(150)
    })

    it('the Batch amount equals Σ member net and EXCLUDES commission+GST+TDS+TCS', () => {
      // One member: gross 10000, deductions 2000+360+10+50 = 2420 retained.
      const batches = planPayoutBatches({
        payouts: [eligiblePayout()],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      const [batch] = batches
      // The transfer is the net only — the 2420 of deductions never appears.
      expect(batch!.amountNetRupees).toBe(7580)
      expect(batch!.amountNetRupees).not.toBe(10000)
    })

    it('carries the payoutMethod onto the Batch (upi → UPI transfer mode)', () => {
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ payoutMethod: 'upi' })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches[0]!.payoutMethod).toBe('upi')
    })
  })

  describe('eligibility filter', () => {
    it('excludes a Payout with no completedAt', () => {
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt: null })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('excludes a Payout still inside its maturity window (T+7 not yet reached)', () => {
      // completed 3 days before now → 3 < 7, not matured.
      const completedAt = new Date(NOW.getTime() - 3 * 86_400_000)
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('includes a Payout exactly AT the T+7 maturity boundary', () => {
      // completed exactly 7 days before now → completion + 7d === now → matured.
      const completedAt = new Date(NOW.getTime() - 7 * 86_400_000)
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(1)
    })

    it('uses the T+30 window for permit-required Bookings', () => {
      // completed 10 days ago: matured under T+7 but NOT under T+30.
      const completedAt = new Date(NOW.getTime() - 10 * 86_400_000)
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt, permitRequired: true })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('uses the T+30 window for multi-day Bookings', () => {
      const completedAt = new Date(NOW.getTime() - 10 * 86_400_000)
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt, multiDay: true })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('matures a T+30 Booking once 30 days have elapsed', () => {
      const completedAt = new Date(NOW.getTime() - 30 * 86_400_000)
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ completedAt, permitRequired: true })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(1)
    })
  })

  describe('first-3 manual-approval gate', () => {
    it('includes an approved Payout regardless of remaining manual count', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ payoutState: 'approved', vendorManualPayoutsRemaining: 3 }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(1)
    })

    it('includes a pending Payout when the vendor has 0 manual approvals remaining', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ payoutState: 'pending', vendorManualPayoutsRemaining: 0 }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(1)
    })

    it('EXCLUDES a pending Payout while the vendor still has manual approvals remaining', () => {
      const batches = planPayoutBatches({
        payouts: [
          eligiblePayout({ payoutState: 'pending', vendorManualPayoutsRemaining: 2 }),
        ],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('excludes a rejected Payout', () => {
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ payoutState: 'rejected' })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })

    it('excludes a held Payout', () => {
      const batches = planPayoutBatches({
        payouts: [eligiblePayout({ payoutState: 'held' })],
        now: NOW,
        batchDay: BATCH_DAY,
      })
      expect(batches).toHaveLength(0)
    })
  })

  it('returns no Batches for an empty input', () => {
    expect(planPayoutBatches({ payouts: [], now: NOW, batchDay: BATCH_DAY })).toEqual([])
  })
})
