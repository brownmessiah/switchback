import { describe, expect, it } from 'vitest'

import {
  PAYOUT_DEFAULT_WINDOW_DAYS,
  PAYOUT_EXTENDED_WINDOW_DAYS,
  computeVendorNetPayout,
  payoutWindowDays,
} from './payout-calculator'

/**
 * Vendor net-payout worked example per ADR-0016:
 *
 *   net = booking_gross
 *         − Commission
 *         − GST (18% IGST on commission)
 *         − TDS (Section 194-O, 0.1% on gross, ₹5L individual/HUF exemption)
 *         − GST TCS (Section 52, 0.5% on net taxable supply value)
 *
 * `computeVendorNetPayout` is a PURE function over the snapshot columns
 * locked at Booking-create. It re-derives commission + GST from the
 * snapshotted rates and consumes the persisted TDS + TCS amounts (already
 * floored to whole rupees at create). This is the single source of truth
 * the M3 Payout batch reads to disburse via Razorpay X.
 */
describe('computeVendorNetPayout (ADR-0016 worked example)', () => {
  it('worked example: gross ₹10,000, 20% commission, TDS deducted (over ₹5L)', () => {
    // gross           = 10000
    // commission 20%  = 2000
    // GST 18% on 2000 = 360
    // TDS 0.1% gross  = 10   (vendor over the ₹5L threshold → deducted)
    // TCS 0.5% gross  = 50   (0.5% of the 10000 taxable supply value)
    // net = 10000 − 2000 − 360 − 10 − 50 = 7580
    const r = computeVendorNetPayout({
      grossRupees: 10000,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 10,
      tcsRupees: 50,
    })
    expect(r.commissionRupees).toBe(2000)
    expect(r.gstOnCommissionRupees).toBe(360)
    expect(r.tdsRupees).toBe(10)
    expect(r.tcsRupees).toBe(50)
    expect(r.netPayoutRupees).toBe(7580)
  })

  it('worked example: same booking but vendor UNDER ₹5L → no TDS (net is ₹10 higher)', () => {
    // Identical to above except the individual/HUF vendor is under the ₹5L
    // FY threshold, so TDS = 0. net = 10000 − 2000 − 360 − 0 − 50 = 7590.
    const r = computeVendorNetPayout({
      grossRupees: 10000,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 0,
      tcsRupees: 50,
    })
    expect(r.commissionRupees).toBe(2000)
    expect(r.gstOnCommissionRupees).toBe(360)
    expect(r.tdsRupees).toBe(0)
    expect(r.tcsRupees).toBe(50)
    expect(r.netPayoutRupees).toBe(7590)
  })

  it('floors commission and GST to whole rupees (no fractional payouts)', () => {
    // gross 3333, commission 20% = 666.6 → 666
    // GST 18% on 666 = 119.88 → 119
    // tds 3, tcs 16 (supplied pre-floored by the calculators)
    // net = 3333 − 666 − 119 − 3 − 16 = 2529
    const r = computeVendorNetPayout({
      grossRupees: 3333,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 3,
      tcsRupees: 16,
    })
    expect(r.commissionRupees).toBe(666)
    expect(r.gstOnCommissionRupees).toBe(119)
    expect(r.netPayoutRupees).toBe(2529)
  })

  it('returns a breakdown that sums back to gross (net + all deductions = gross)', () => {
    const r = computeVendorNetPayout({
      grossRupees: 10000,
      commissionRatePercent: '20.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 10,
      tcsRupees: 50,
    })
    const reconstructed =
      r.netPayoutRupees +
      r.commissionRupees +
      r.gstOnCommissionRupees +
      r.tdsRupees +
      r.tcsRupees
    expect(reconstructed).toBe(10000)
  })

  it('handles a zero-commission booking (platform takes nothing → net ≈ gross − taxes)', () => {
    const r = computeVendorNetPayout({
      grossRupees: 5000,
      commissionRatePercent: '0.00',
      gstRateOnCommissionPercent: '18.00',
      tdsRupees: 5,
      tcsRupees: 25,
    })
    expect(r.commissionRupees).toBe(0)
    expect(r.gstOnCommissionRupees).toBe(0)
    expect(r.netPayoutRupees).toBe(4970) // 5000 − 0 − 0 − 5 − 25
  })

  it('throws when net would go negative (mis-snapshotted inputs guard)', () => {
    expect(() =>
      computeVendorNetPayout({
        grossRupees: 100,
        commissionRatePercent: '90.00',
        gstRateOnCommissionPercent: '18.00',
        tdsRupees: 50,
        tcsRupees: 50,
      }),
    ).toThrow(/negative/i)
  })

  it('throws on non-integer gross (rupee precision required)', () => {
    expect(() =>
      computeVendorNetPayout({
        grossRupees: 100.5,
        commissionRatePercent: '20.00',
        gstRateOnCommissionPercent: '18.00',
        tdsRupees: 0,
        tcsRupees: 0,
      }),
    ).toThrow(/integer/i)
  })
})

/**
 * Extended dispute window per ADR-0016: the Payout countdown is T+7 from
 * Completion by default, extended to T+30 for permit-required Bookings and
 * multi-day treks (the higher-risk supply where a Customer dispute may
 * surface late).
 */
describe('payoutWindowDays (ADR-0016 extended dispute window)', () => {
  it('exports the default + extended window constants (T+7 / T+30)', () => {
    expect(PAYOUT_DEFAULT_WINDOW_DAYS).toBe(7)
    expect(PAYOUT_EXTENDED_WINDOW_DAYS).toBe(30)
  })

  it('defaults to T+7 for a single-day, no-permit booking', () => {
    expect(payoutWindowDays({ permitRequired: false, multiDay: false })).toBe(7)
  })

  it('extends to T+30 when the Experience requires a permit', () => {
    expect(payoutWindowDays({ permitRequired: true, multiDay: false })).toBe(30)
  })

  it('extends to T+30 for a multi-day trek', () => {
    expect(payoutWindowDays({ permitRequired: false, multiDay: true })).toBe(30)
  })

  it('extends to T+30 when both permit-required and multi-day', () => {
    expect(payoutWindowDays({ permitRequired: true, multiDay: true })).toBe(30)
  })
})
