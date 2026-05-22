import { describe, expect, it } from 'vitest'

import { quoteTds, TDS_RATE_PERCENT_SECTION_194O } from './tds-calculator'

/**
 * TDS u/s 194-O of the Income Tax Act per ADR-0016. 1% deduction on the
 * gross Booking value to resident-Indian Vendors. Foreign Vendors not
 * subject to 194-O (and out of v1 scope anyway). Quarterly Form 26Q
 * filings require the deductee PAN — a resident-Vendor Booking without
 * PAN is rejected at the application layer (NOT NULL on PAN snapshot
 * would have been ideal but the schema permits NULL for non-resident
 * paths; the calculator throws to keep the audit trail clean).
 */
describe('quoteTds (ADR-0016 Section 194-O)', () => {
  it('quotes 1% TDS for a resident vendor with PAN', () => {
    const r = quoteTds({ grossRupees: 10000, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(100)
    expect(r.tdsRatePercent).toBe('1.00')
    expect(r.basis).toBe('section_194o_resident')
  })

  it('floors fractional rupees (1% of 9999 = 99.99 → 99)', () => {
    const r = quoteTds({ grossRupees: 9999, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(99)
  })

  it('returns 0 TDS for non-resident vendors (Section 194-O does not apply)', () => {
    const r = quoteTds({ grossRupees: 50000, vendorIsResident: false, vendorPan: null })
    expect(r.tdsRupees).toBe(0)
    expect(r.tdsRatePercent).toBe('0.00')
    expect(r.basis).toBe('non_resident_exempt')
  })

  it('returns 0 TDS at gross 0 without requiring PAN (free booking edge)', () => {
    const r = quoteTds({ grossRupees: 0, vendorIsResident: true, vendorPan: null })
    expect(r.tdsRupees).toBe(0)
  })

  it('throws when resident vendor has no PAN (Form 26Q requires deductee PAN)', () => {
    expect(() =>
      quoteTds({ grossRupees: 5000, vendorIsResident: true, vendorPan: null }),
    ).toThrow(/PAN/)
  })

  it('throws when grossRupees is negative', () => {
    expect(() =>
      quoteTds({ grossRupees: -1, vendorIsResident: true, vendorPan: 'ABCDE1234F' }),
    ).toThrow(/non-negative/i)
  })

  it('throws when grossRupees is a non-integer (rupee precision required)', () => {
    expect(() =>
      quoteTds({ grossRupees: 1.5, vendorIsResident: true, vendorPan: 'ABCDE1234F' }),
    ).toThrow(/integer/i)
  })

  it('exports the TDS rate constant (1%)', () => {
    expect(TDS_RATE_PERCENT_SECTION_194O).toBe('1.00')
  })
})
