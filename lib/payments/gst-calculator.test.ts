import { describe, expect, it } from 'vitest'

import { GST_RATE_ON_COMMISSION, quoteGstOnCommission } from './gst-calculator'

/**
 * 18% IGST on the Switchback commission revenue per ADR-0016. Applies
 * regardless of Vendor GSTIN status — the difference is whether the
 * Vendor can claim input credit on their own return. Switchback issues a
 * GST invoice in both cases.
 */
describe('quoteGstOnCommission (ADR-0016)', () => {
  it('quotes 18% GST on a Rs.500 commission (Rs.90)', () => {
    const r = quoteGstOnCommission({ commissionRupees: 500 })
    expect(r.gstRupees).toBe(90)
    expect(r.gstRatePercent).toBe('18.00')
    expect(r.basis).toBe('igst_18')
  })

  it('quotes 0 GST on 0 commission', () => {
    const r = quoteGstOnCommission({ commissionRupees: 0 })
    expect(r.gstRupees).toBe(0)
    expect(r.gstRatePercent).toBe('18.00')
  })

  it('floors fractional rupees (18% of 99 = 17.82 → 17)', () => {
    const r = quoteGstOnCommission({ commissionRupees: 99 })
    expect(r.gstRupees).toBe(17)
  })

  it('throws when commissionRupees is negative', () => {
    expect(() => quoteGstOnCommission({ commissionRupees: -1 })).toThrow(/non-negative/i)
  })

  it('throws when commissionRupees is a non-integer (rupee precision required)', () => {
    expect(() => quoteGstOnCommission({ commissionRupees: 1.5 })).toThrow(/integer/i)
  })

  it('exports the GST rate constant (18%)', () => {
    expect(GST_RATE_ON_COMMISSION).toBe('18.00')
  })
})
