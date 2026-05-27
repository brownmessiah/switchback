/**
 * TDS u/s 194-O calculator per ADR-0016.
 *
 * Finance Act 2024 (effective 1 Oct 2024) reduced the Section 194-O
 * rate from 1% to 0.1% on the gross Booking value paid to resident-
 * Indian Vendors. Filed quarterly via Form 26Q (the deductee PAN is
 * required for the filing — that's why resident-vendor with NULL PAN
 * throws).
 *
 * Foreign Vendors are not subject to 194-O. Note that v1 has no foreign-
 * Vendor onboarding flow yet; the non-resident arm exists so a future
 * onboarding path can short-circuit the calculator cleanly.
 *
 * Money is integer rupees; fractional rupees floor (rupee-level
 * precision is the granularity Razorpay round-trips and what shows up
 * on the GST + 26Q filings).
 */

export const TDS_RATE_PERCENT_SECTION_194O = '0.10'

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

  if (!Number.isInteger(grossRupees)) {
    throw new Error('grossRupees must be an integer (rupee precision)')
  }
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
    // TODO(206AA): Section 206AA mandates a higher TDS rate of 5% when the
    // deductee (Vendor) has not furnished their PAN. Currently we throw to
    // block the booking-create call, because the Form 26Q quarterly filing
    // requires the PAN. When a no-PAN onboarding path is added, replace this
    // throw with: tdsRupees = Math.floor((grossRupees * 5) / 100) at 5%.
    throw new Error(
      'TDS u/s 194-O requires the Vendor PAN for quarterly Form 26Q filing; reject the Booking-create call at the application layer',
    )
  }
  return {
    tdsRupees: Math.floor((grossRupees * 1) / 1000),
    tdsRatePercent: TDS_RATE_PERCENT_SECTION_194O,
    basis: 'section_194o_resident',
  }
}
