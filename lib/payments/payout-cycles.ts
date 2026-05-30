/**
 * Payout-cycle grouping for the Vendor "Earnings Ledger" (#81).
 *
 * The Earnings Ledger is the payouts surface's spine: it groups the Vendor's
 * payout-relevant Bookings into PAYOUT CYCLES derived entirely from REAL data
 * (the Booking's completion timestamp + the ADR-0016 payout window) — never a
 * fabricated cadence. Each cycle expands to its constituent Bookings, each
 * carrying the full Gross → Commission → GST → TDS → TCS → Net trail produced
 * by the EXISTING `computeVendorNetPayout` (re-derives Commission + GST from
 * the snapshot RATES; consumes the pre-floored TDS / TCS rupee AMOUNTS). This
 * module adds NO new money math and changes NO calculation.
 *
 * Release date (the cycle key):
 *
 *   releaseDate = completedAt + payoutWindowDays         (per ADR-0016)
 *     default  = T+7
 *     extended = T+30   for permit-required OR multi-day Bookings
 *
 * Bookings sharing one release calendar date fall in one cycle; cycles are
 * surfaced newest-release-first. A Booking that has not completed (no
 * `completedAt`) has no release date and is excluded.
 */

import {
  computeVendorNetPayout,
  payoutWindowDays,
  type VendorNetPayout,
} from './payout-calculator'

/** A payout-relevant Booking as read (read-only) from the DB for the ledger. */
export interface PayoutCycleBookingInput {
  bookingId: string
  experienceTitle: string
  customerName: string | null
  /** Completion timestamp; null while the Booking is awaiting_completion. */
  completedAt: Date | null
  /** ADR-0016 payout processing state (pending/paid/etc). */
  payoutState: string
  grossRupees: number
  commissionRatePercent: string
  gstRateOnCommissionPercent: string
  tdsRupees: number
  tcsRupees: number
  /** Experience requires one or more permits (extends the window to T+30). */
  permitRequired: boolean
  /** Booked slot spans more than one calendar day (extends to T+30). */
  multiDay: boolean
}

/** One constituent Booking row of a cycle, with its full deduction trail. */
export interface PayoutCycleBooking extends VendorNetPayout {
  bookingId: string
  experienceTitle: string
  customerName: string | null
  completedAt: Date
  payoutState: string
  releaseDate: Date
}

export interface PayoutCycle {
  /** Midnight (UTC) of the cycle's release calendar date — the group key. */
  releaseDate: Date
  /** 'pending' while any constituent Booking is unpaid; else 'paid'. */
  status: 'pending' | 'paid'
  bookings: PayoutCycleBooking[]
  totals: VendorNetPayout
}

/** UTC-midnight key for a release date so same-day completions group together. */
function releaseDateKey(date: Date): string {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString()
}

const EMPTY_TOTALS: VendorNetPayout = {
  grossRupees: 0,
  commissionRupees: 0,
  gstOnCommissionRupees: 0,
  tdsRupees: 0,
  tcsRupees: 0,
  netPayoutRupees: 0,
}

function addTrail(acc: VendorNetPayout, row: VendorNetPayout): VendorNetPayout {
  return {
    grossRupees: acc.grossRupees + row.grossRupees,
    commissionRupees: acc.commissionRupees + row.commissionRupees,
    gstOnCommissionRupees: acc.gstOnCommissionRupees + row.gstOnCommissionRupees,
    tdsRupees: acc.tdsRupees + row.tdsRupees,
    tcsRupees: acc.tcsRupees + row.tcsRupees,
    netPayoutRupees: acc.netPayoutRupees + row.netPayoutRupees,
  }
}

export function groupBookingsIntoPayoutCycles(
  inputs: readonly PayoutCycleBookingInput[],
): PayoutCycle[] {
  const byCycle = new Map<string, PayoutCycle>()

  for (const input of inputs) {
    // No completion → no release date → not yet a payout-cycle member.
    if (!input.completedAt) continue

    const windowDays = payoutWindowDays({
      permitRequired: input.permitRequired,
      multiDay: input.multiDay,
    })
    const releaseAt = new Date(input.completedAt)
    releaseAt.setUTCDate(releaseAt.getUTCDate() + windowDays)

    // Re-use the existing, audited payout calculator for the deduction trail.
    const trail = computeVendorNetPayout({
      grossRupees: input.grossRupees,
      commissionRatePercent: input.commissionRatePercent,
      gstRateOnCommissionPercent: input.gstRateOnCommissionPercent,
      tdsRupees: input.tdsRupees,
      tcsRupees: input.tcsRupees,
    })

    const key = releaseDateKey(releaseAt)
    const row: PayoutCycleBooking = {
      ...trail,
      bookingId: input.bookingId,
      experienceTitle: input.experienceTitle,
      customerName: input.customerName,
      completedAt: input.completedAt,
      payoutState: input.payoutState,
      releaseDate: new Date(key),
    }

    const existing = byCycle.get(key)
    if (existing) {
      existing.bookings.push(row)
      existing.totals = addTrail(existing.totals, trail)
      if (input.payoutState !== 'paid') existing.status = 'pending'
    } else {
      byCycle.set(key, {
        releaseDate: new Date(key),
        status: input.payoutState === 'paid' ? 'paid' : 'pending',
        bookings: [row],
        totals: addTrail(EMPTY_TOTALS, trail),
      })
    }
  }

  // Newest release cycle first (most recent earnings on top).
  return [...byCycle.values()].sort(
    (a, b) => b.releaseDate.getTime() - a.releaseDate.getTime(),
  )
}
