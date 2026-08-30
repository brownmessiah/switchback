import { describe, expect, it } from 'vitest'

import { quoteTcs, TCS_RATE_PERCENT_SECTION_52 } from './tcs-calculator'

/**
 * GST TCS u/s Section 52 of the CGST Act per ADR-0016.
 *
 * Switchback collects Customer payments on the Vendor's behalf, so it is an
 * "e-commerce operator" and must collect TCS on the net taxable value of
 * the Vendor's supplies through the platform. Rate is 0.5% (0.25% CGST +
 * 0.25% SGST intra-state, or 0.5% IGST inter-state) since 10 Jul 2024.
 * Filed monthly via GSTR-8. Separate from and additional to the 18% GST
 * on Switchback' own commission.
 *
 * The taxable base (`taxableValueRupees`) is supplied by the caller — the
 * exact base (booking value net of GST/returns) is confirmed with the CA
 * per ADR-0016; this calculator only applies the rate.
 */
describe('quoteTcs (ADR-0016 Section 52)', () => {
  it('quotes 0.5% TCS on a ₹10,000 taxable value (₹50)', () => {
    const r = quoteTcs({ taxableValueRupees: 10000 })
    expect(r.tcsRupees).toBe(50)
    expect(r.tcsRatePercent).toBe('0.50')
    expect(r.basis).toBe('tcs_section_52')
  })

  it('quotes 0 TCS on 0 taxable value', () => {
    const r = quoteTcs({ taxableValueRupees: 0 })
    expect(r.tcsRupees).toBe(0)
    expect(r.tcsRatePercent).toBe('0.50')
  })

  it('floors fractional rupees (0.5% of 999 = 4.995 → 4)', () => {
    const r = quoteTcs({ taxableValueRupees: 999 })
    expect(r.tcsRupees).toBe(4)
  })

  it('calculates 0.5% correctly for a large supply (₹5,00,000 → TCS ₹2,500)', () => {
    const r = quoteTcs({ taxableValueRupees: 500000 })
    expect(r.tcsRupees).toBe(2500)
  })

  it('floors a ₹1 supply (0.5% of 1 = 0.005 → 0)', () => {
    const r = quoteTcs({ taxableValueRupees: 1 })
    expect(r.tcsRupees).toBe(0)
    expect(r.basis).toBe('tcs_section_52')
  })

  it('throws when taxableValueRupees is negative', () => {
    expect(() => quoteTcs({ taxableValueRupees: -1 })).toThrow(/non-negative/i)
  })

  it('throws when taxableValueRupees is a non-integer (rupee precision required)', () => {
    expect(() => quoteTcs({ taxableValueRupees: 1.5 })).toThrow(/integer/i)
  })

  it('exports the TCS rate constant (0.5% per Notification 15/2024)', () => {
    expect(TCS_RATE_PERCENT_SECTION_52).toBe('0.50')
  })
})
