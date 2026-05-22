/**
 * GST on Outvers commission per ADR-0016.
 *
 * 18% IGST applies regardless of the Vendor's GSTIN status — the
 * difference is whether the Vendor can claim input credit on their own
 * GST return. Outvers issues a GST invoice in either case. The rate
 * snapshots onto bookings.gst_rate_on_commission_snapshot at create
 * time so historical payouts do not drift if the IGST rate changes
 * in a future Finance Bill.
 *
 * Vendor net payout = booking_gross - commission - GST_on_commission - TDS
 * (the actual payout math lives in M3 lib/payments/payout-calculator.ts;
 *  this calculator is the upstream input for the GST term).
 *
 * Money is integer rupees; fractional rupees floor.
 */

export const GST_RATE_ON_COMMISSION = '18.00'

export type GstBasis = 'igst_18'

export interface GstQuote {
  gstRupees: number
  gstRatePercent: string
  basis: GstBasis
}

export interface QuoteGstArgs {
  commissionRupees: number
}

export function quoteGstOnCommission(args: QuoteGstArgs): GstQuote {
  const { commissionRupees } = args

  if (commissionRupees < 0) {
    throw new Error('commissionRupees must be non-negative')
  }

  return {
    gstRupees: Math.floor((commissionRupees * 18) / 100),
    gstRatePercent: GST_RATE_ON_COMMISSION,
    basis: 'igst_18',
  }
}
