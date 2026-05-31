/**
 * Vendor net-payout calculator per ADR-0016.
 *
 * The Payout disbursed to the Vendor at T+7 (or T+30 — see the extended
 * dispute window below) is the booking gross net of every platform and
 * statutory deduction:
 *
 *   net = booking_gross
 *         − Commission                      (commission_rate_snapshot × gross)
 *         − GST on Commission               (18% IGST on the commission)
 *         − TDS u/s 194-O                   (0.1% on gross; ₹5L individual/HUF
 *                                            exemption — already applied when
 *                                            the snapshot was taken at create)
 *         − GST TCS u/s Section 52          (0.5% on the Vendor's net taxable
 *                                            supply value)
 *
 * This is a PURE function over the snapshot columns locked at
 * Booking-create. Commission and GST are re-derived from the snapshotted
 * RATES so a future rate change never re-prices a historical Booking; TDS
 * and TCS are consumed as the already-floored rupee AMOUNTS that
 * `quoteTds` / `quoteTcs` computed and `createBooking` persisted onto the
 * row. The M3 Payout batch reads exactly this to disburse via Razorpay X.
 *
 * Money is integer rupees throughout; commission + GST floor to whole
 * rupees (rupee-level precision is what Razorpay round-trips and what the
 * GST / 26Q filings carry).
 */

export interface VendorNetPayoutArgs {
  /** booking gross, integer rupees (bookings.gross_total_snapshot). */
  grossRupees: number
  /** numeric(5,2) string e.g. '20.00' (bookings.commission_rate_snapshot). */
  commissionRatePercent: string
  /** numeric(5,2) string e.g. '18.00' (bookings.gst_rate_on_commission_snapshot). */
  gstRateOnCommissionPercent: string
  /** integer rupees, pre-floored at create (bookings.tds_amount_snapshot). */
  tdsRupees: number
  /** integer rupees, pre-floored at create (bookings.tcs_amount_snapshot). */
  tcsRupees: number
}

export interface VendorNetPayout {
  grossRupees: number
  commissionRupees: number
  gstOnCommissionRupees: number
  tdsRupees: number
  tcsRupees: number
  netPayoutRupees: number
}

export function computeVendorNetPayout(args: VendorNetPayoutArgs): VendorNetPayout {
  const { grossRupees, commissionRatePercent, gstRateOnCommissionPercent, tdsRupees, tcsRupees } =
    args

  if (!Number.isInteger(grossRupees)) {
    throw new Error('grossRupees must be an integer (rupee precision)')
  }
  if (!Number.isInteger(tdsRupees) || !Number.isInteger(tcsRupees)) {
    throw new Error('tdsRupees and tcsRupees must be integers (rupee precision)')
  }
  if (grossRupees < 0 || tdsRupees < 0 || tcsRupees < 0) {
    throw new Error('payout inputs must be non-negative')
  }

  const commissionRate = Number(commissionRatePercent)
  const gstRate = Number(gstRateOnCommissionPercent)
  if (Number.isNaN(commissionRate) || Number.isNaN(gstRate)) {
    throw new Error('commission and GST rates must be numeric strings')
  }

  // Commission = rate% of gross, floored to whole rupees.
  const commissionRupees = Math.floor((grossRupees * commissionRate) / 100)
  // GST = gstRate% of commission, floored to whole rupees.
  const gstOnCommissionRupees = Math.floor((commissionRupees * gstRate) / 100)

  const netPayoutRupees =
    grossRupees - commissionRupees - gstOnCommissionRupees - tdsRupees - tcsRupees

  if (netPayoutRupees < 0) {
    throw new Error(
      `vendor net payout would be negative (${netPayoutRupees}); inputs are inconsistent — gross ${grossRupees}, commission ${commissionRupees}, gst ${gstOnCommissionRupees}, tds ${tdsRupees}, tcs ${tcsRupees}`,
    )
  }

  return {
    grossRupees,
    commissionRupees,
    gstOnCommissionRupees,
    tdsRupees,
    tcsRupees,
    netPayoutRupees,
  }
}

/**
 * Payout / dispute-window length per ADR-0016.
 *
 *   default  = T+7  from Completion
 *   extended = T+30 for permit-required Bookings AND multi-day treks
 *
 * The extended window gives the higher-risk supply (where a Customer
 * dispute may surface late — a permit problem on day 3 of a trek, say) a
 * longer hold before the Vendor Payout is released.
 */
export const PAYOUT_DEFAULT_WINDOW_DAYS = 7
export const PAYOUT_EXTENDED_WINDOW_DAYS = 30

export interface PayoutWindowArgs {
  /** Experience requires one or more permits (experiences.required_permits non-empty). */
  permitRequired: boolean
  /** Booked slot spans more than one calendar day (multi-day trek). */
  multiDay: boolean
}

export function payoutWindowDays(args: PayoutWindowArgs): number {
  return args.permitRequired || args.multiDay
    ? PAYOUT_EXTENDED_WINDOW_DAYS
    : PAYOUT_DEFAULT_WINDOW_DAYS
}
