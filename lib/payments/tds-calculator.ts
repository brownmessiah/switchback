/**
 * TDS u/s 194-O calculator per ADR-0016.
 *
 * 1% deduction on the gross Booking value paid to resident-Indian
 * Vendors. Filed quarterly via Form 26Q (the deductee PAN is required
 * for the filing — that's why resident-vendor with NULL PAN throws).
 *
 * Foreign Vendors are not subject to 194-O. Note that v1 has no foreign-
 * Vendor onboarding flow yet; the non-resident arm exists so a future
 * onboarding path can short-circuit the calculator cleanly.
 *
 * Money is integer rupees; fractional rupees floor (rupee-level
 * precision is the granularity Razorpay round-trips and what shows up
 * on the GST + 26Q filings).
 */

export const TDS_RATE_PERCENT_SECTION_194O = '1.00'

export type TdsBasis = 'section_194o_resident' | 'non_resident_exempt'

export interface TdsQuote {
  tdsRupees: number
  tdsRatePercent: string
  basis: TdsBasis
}

export interface QuoteTdsArgs {
  grossRupees: number
  vendorIsResident: boolean
  vendorPan: string | null
}

export function quoteTds(args: QuoteTdsArgs): TdsQuote {
  const { grossRupees, vendorIsResident, vendorPan } = args

  if (grossRupees < 0) {
    throw new Error('grossRupees must be non-negative')
  }
  if (!vendorIsResident) {
    return {
      tdsRupees: 0,
      tdsRatePercent: '0.00',
      basis: 'non_resident_exempt',
    }
  }
  if (grossRupees === 0) {
    // Free-booking edge: no PAN requirement when there's nothing to deduct.
    return {
      tdsRupees: 0,
      tdsRatePercent: TDS_RATE_PERCENT_SECTION_194O,
      basis: 'section_194o_resident',
    }
  }
  if (!vendorPan) {
    throw new Error(
      'TDS u/s 194-O requires the Vendor PAN for quarterly Form 26Q filing; reject the Booking-create call at the application layer',
    )
  }
  return {
    tdsRupees: Math.floor((grossRupees * 1) / 100),
    tdsRatePercent: TDS_RATE_PERCENT_SECTION_194O,
    basis: 'section_194o_resident',
  }
}
