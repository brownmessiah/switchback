/**
 * GST TCS u/s Section 52 of the CGST Act per ADR-0016.
 *
 * Outvers collects Customer payments on the Vendor's behalf, so it is an
 * "e-commerce operator" under Section 52 and must collect TCS on the net
 * taxable value of the Vendor's supplies through the platform. The rate is
 * 0.5% (0.25% CGST + 0.25% SGST intra-state, or 0.5% IGST inter-state),
 * reduced from 1% by Notification 15/2024 w.e.f. 10 Jul 2024. Collected
 * per Booking, remitted monthly via GSTR-8, and credited to the Vendor's
 * GSTIN ledger (the Vendor claims it on their own return). This is separate
 * from and additional to the 18% GST on Outvers' own commission.
 *
 * The taxable base (`taxableValueRupees`) is supplied by the caller. The
 * exact base — the Vendor's supply value net of GST and returns — is
 * confirmed with the CA per ADR-0016; this calculator only applies the
 * rate. The rate snapshots onto bookings.tcs_rate_snapshot at create time
 * so historical payouts don't drift if the rate changes in a future
 * notification.
 *
 * Money is integer rupees; fractional rupees floor (rupee-level precision
 * is what Razorpay round-trips and what shows on the GSTR-8 filing).
 */

export const TCS_RATE_PERCENT_SECTION_52 = '0.50'

export type TcsBasis = 'tcs_section_52'

export interface TcsQuote {
  tcsRupees: number
  tcsRatePercent: string
  basis: TcsBasis
}

export interface QuoteTcsArgs {
  taxableValueRupees: number
}

export function quoteTcs(args: QuoteTcsArgs): TcsQuote {
  const { taxableValueRupees } = args

  if (!Number.isInteger(taxableValueRupees)) {
    throw new Error('taxableValueRupees must be an integer (rupee precision)')
  }
  if (taxableValueRupees < 0) {
    throw new Error('taxableValueRupees must be non-negative')
  }

  return {
    // 0.5% = ×5/1000, floored to whole rupees.
    tcsRupees: Math.floor((taxableValueRupees * 5) / 1000),
    tcsRatePercent: TCS_RATE_PERCENT_SECTION_52,
    basis: 'tcs_section_52',
  }
}
