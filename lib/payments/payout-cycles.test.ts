import { describe, expect, it } from 'vitest'

import { groupBookingsIntoPayoutCycles } from './payout-cycles'

/**
 * Payout-cycle grouping for the Vendor "Earnings Ledger" (#81).
 *
 * The ledger groups the Vendor's payout-relevant Bookings into PAYOUT CYCLES
 * derived from REAL data — never fabricated:
 *
 *   release date = completedAt + payoutWindowDays    (T+7, or T+30 for
 *                  permit-required / multi-day per ADR-0016)
 *
 * Each cycle expands to its constituent Bookings, each carrying the full
 * Gross → Commission → GST → TDS → TCS → Net trail computed via the EXISTING
 * `computeVendorNetPayout` (no re-implementation, no calc change). Per-cycle
 * totals are the sum over the cycle's rows. The helper is a PURE function over
 * the snapshot columns + the completion timestamp + the payout state.
 */
describe('groupBookingsIntoPayoutCycles (Earnings Ledger #81)', () => {
  const base = {
    commissionRatePercent: '20.00',
    gstRateOnCommissionPercent: '18.00',
    permitRequired: false,
    multiDay: false,
  }

  it('returns no cycles for an empty input', () => {
    expect(groupBookingsIntoPayoutCycles([])).toEqual([])
  })

  it('derives the release date as completedAt + 7 days (default window)', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'b1',
        experienceTitle: 'Goa Scuba',
        customerName: 'Asha',
        completedAt: new Date('2026-05-01T00:00:00.000Z'),
        payoutState: 'pending',
        grossRupees: 100_000,
        tdsRupees: 100,
        tcsRupees: 500,
        ...base,
      },
    ])

    expect(cycles).toHaveLength(1)
    // T+7 from completion 2026-05-01 → release 2026-05-08.
    expect(cycles[0].releaseDate.toISOString()).toBe('2026-05-08T00:00:00.000Z')
  })

  it('uses the T+30 extended window for permit-required Bookings', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'b1',
        experienceTitle: 'Sikkim Permit Trek',
        customerName: 'Asha',
        completedAt: new Date('2026-05-01T00:00:00.000Z'),
        payoutState: 'pending',
        grossRupees: 50_000,
        tdsRupees: 50,
        tcsRupees: 250,
        commissionRatePercent: '20.00',
        gstRateOnCommissionPercent: '18.00',
        permitRequired: true,
        multiDay: false,
      },
    ])

    // T+30 from completion 2026-05-01 → release 2026-05-31.
    expect(cycles[0].releaseDate.toISOString()).toBe('2026-05-31T00:00:00.000Z')
  })

  it('groups Bookings sharing one release date into one cycle and sums the tax trail', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'b1',
        experienceTitle: 'Goa Scuba',
        customerName: 'Asha',
        completedAt: new Date('2026-05-01T00:00:00.000Z'),
        payoutState: 'pending',
        grossRupees: 100_000, // comm 20000, gst 3600, net 75800
        tdsRupees: 100,
        tcsRupees: 500,
        ...base,
      },
      {
        bookingId: 'b2',
        experienceTitle: 'Goa Kayak',
        customerName: 'Ravi',
        completedAt: new Date('2026-05-01T09:00:00.000Z'), // same calendar release date
        payoutState: 'pending',
        grossRupees: 10_000, // comm 2000, gst 360, net 7580
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
    ])

    expect(cycles).toHaveLength(1)
    const cycle = cycles[0]
    expect(cycle.bookings).toHaveLength(2)

    // Per-row trail comes straight from computeVendorNetPayout.
    const b1 = cycle.bookings.find((b) => b.bookingId === 'b1')!
    expect(b1.grossRupees).toBe(100_000)
    expect(b1.commissionRupees).toBe(20_000)
    expect(b1.gstOnCommissionRupees).toBe(3_600)
    expect(b1.tdsRupees).toBe(100)
    expect(b1.tcsRupees).toBe(500)
    expect(b1.netPayoutRupees).toBe(75_800)

    // Per-cycle totals = sum over the rows, and reconcile exactly.
    expect(cycle.totals.grossRupees).toBe(110_000)
    expect(cycle.totals.commissionRupees).toBe(22_000)
    expect(cycle.totals.gstOnCommissionRupees).toBe(3_960)
    expect(cycle.totals.tdsRupees).toBe(110)
    expect(cycle.totals.tcsRupees).toBe(550)
    expect(cycle.totals.netPayoutRupees).toBe(83_380)
    expect(
      cycle.totals.grossRupees -
        cycle.totals.commissionRupees -
        cycle.totals.gstOnCommissionRupees -
        cycle.totals.tdsRupees -
        cycle.totals.tcsRupees,
    ).toBe(cycle.totals.netPayoutRupees)
  })

  it('splits Bookings with different release dates into separate cycles, newest first', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'older',
        experienceTitle: 'Goa Scuba',
        customerName: 'Asha',
        completedAt: new Date('2026-04-01T00:00:00.000Z'),
        payoutState: 'paid',
        grossRupees: 10_000,
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
      {
        bookingId: 'newer',
        experienceTitle: 'Goa Kayak',
        customerName: 'Ravi',
        completedAt: new Date('2026-05-01T00:00:00.000Z'),
        payoutState: 'pending',
        grossRupees: 10_000,
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
    ])

    expect(cycles).toHaveLength(2)
    // Newest release cycle is surfaced first (most recent earnings on top).
    expect(cycles[0].bookings[0].bookingId).toBe('newer')
    expect(cycles[1].bookings[0].bookingId).toBe('older')
    expect(cycles[0].releaseDate.getTime()).toBeGreaterThan(
      cycles[1].releaseDate.getTime(),
    )
  })

  it('carries a status from the cycle bookings (pending when any row is pending)', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'b1',
        experienceTitle: 'Goa Scuba',
        customerName: 'Asha',
        completedAt: new Date('2026-05-01T00:00:00.000Z'),
        payoutState: 'paid',
        grossRupees: 10_000,
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
      {
        bookingId: 'b2',
        experienceTitle: 'Goa Kayak',
        customerName: 'Ravi',
        completedAt: new Date('2026-05-01T03:00:00.000Z'),
        payoutState: 'pending',
        grossRupees: 10_000,
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
    ])

    // A cycle is "pending" while any constituent Booking has not been paid.
    expect(cycles[0].status).toBe('pending')
  })

  it('excludes Bookings that have not completed yet (no completedAt → no release date)', () => {
    const cycles = groupBookingsIntoPayoutCycles([
      {
        bookingId: 'awaiting',
        experienceTitle: 'Goa Scuba',
        customerName: 'Asha',
        completedAt: null,
        payoutState: 'pending',
        grossRupees: 10_000,
        tdsRupees: 10,
        tcsRupees: 50,
        ...base,
      },
    ])

    expect(cycles).toEqual([])
  })
})
