import { describe, expect, it } from 'vitest'

import { quoteTds, TDS_RATE_PERCENT_SECTION_194O } from './tds-calculator'

/**
 * TDS u/s 194-O of the Income Tax Act per ADR-0016.
 *
 * Finance Act 2024 (effective 1 Oct 2024) reduced the rate from 1% to
 * 0.1% on the gross Booking value paid to resident-Indian Vendors.
 * Foreign Vendors are not subject to 194-O (and out of v1 scope anyway).
 * Quarterly Form 26Q filings require the deductee PAN — a resident-
 * Vendor Booking without PAN is rejected at the application layer.
 */
describe('quoteTds (ADR-0016 Section 194-O)', () => {
  it('quotes 0.1% TDS for a resident vendor with PAN (Finance Act 2024)', () => {
    const r = quoteTds({ grossRupees: 10000, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(10)
    expect(r.tdsRatePercent).toBe('0.10')
    expect(r.basis).toBe('section_194o_resident')
  })

  it('floors fractional rupees (0.1% of 9999 = 9.999 → 9)', () => {
    const r = quoteTds({ grossRupees: 9999, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(9)
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

  // TODO(206AA): When the no-PAN onboarding path is implemented, replace
  // this test with one that asserts 5% TDS under Section 206AA instead of
  // throwing. The higher rate applies when the deductee has not furnished PAN.
  it('no-PAN case currently throws (206AA 5% higher rate is a future path)', () => {
    // Section 206AA: if PAN not furnished, TDS at 5% (higher of 5% or
    // twice the rate in 194-O). Currently blocked at booking-create.
    expect(() =>
      quoteTds({ grossRupees: 20000, vendorIsResident: true, vendorPan: null }),
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

  it('exports the TDS rate constant (0.1% per Finance Act 2024)', () => {
    expect(TDS_RATE_PERCENT_SECTION_194O).toBe('0.10')
  })

  // --- Tax compliance: additional scenarios ---

  it('calculates 0.1% correctly for a large booking (₹5,00,000 → TDS ₹500)', () => {
    const r = quoteTds({ grossRupees: 500000, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(500)
    expect(r.tdsRatePercent).toBe('0.10')
  })

  it('calculates TDS on a ₹1 booking (0.1% of 1 = 0.001 → floors to 0)', () => {
    const r = quoteTds({ grossRupees: 1, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    expect(r.tdsRupees).toBe(0)
    expect(r.basis).toBe('section_194o_resident')
  })

  it('snapshot immutability: TDS amount is computed from the rate at call time, not stored config', () => {
    // ADR-0008: commission snapshot locks rate at booking-create time.
    // This test documents that the calculator uses the constant at import
    // time — if someone changes the constant, existing bookings' snapshot
    // columns in the DB are NOT affected (they were already persisted).
    const r1 = quoteTds({ grossRupees: 100000, vendorIsResident: true, vendorPan: 'ABCDE1234F' })
    const r2 = quoteTds({ grossRupees: 100000, vendorIsResident: true, vendorPan: 'ZZZZZ9999Z' })
    expect(r1.tdsRupees).toBe(r2.tdsRupees)
    expect(r1.tdsRupees).toBe(100) // 0.1% of 100000
  })
})
