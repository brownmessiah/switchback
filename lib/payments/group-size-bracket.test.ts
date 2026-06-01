import { describe, expect, it } from 'vitest'

import { groupSizeBracketPrice, quoteCheckout } from './group-size-bracket'

const PRICES = { tier12: 1500, tier35: 1300, tier6: 1100 }

describe('groupSizeBracketPrice (ADR-0011 group-size brackets, display-side)', () => {
  it('uses the 1-2 bracket for counts 1 and 2', () => {
    expect(groupSizeBracketPrice(PRICES, 1)).toEqual({ pricePerPerson: 1500, basis: 'tier_1_2' })
    expect(groupSizeBracketPrice(PRICES, 2)).toEqual({ pricePerPerson: 1500, basis: 'tier_1_2' })
  })
  it('uses the 3-5 bracket for counts 3, 4, 5 (2→3 crosses the bracket)', () => {
    expect(groupSizeBracketPrice(PRICES, 3)).toEqual({ pricePerPerson: 1300, basis: 'tier_3_5' })
    expect(groupSizeBracketPrice(PRICES, 5)).toEqual({ pricePerPerson: 1300, basis: 'tier_3_5' })
  })
  it('uses the 6+ bracket for counts 6 and up (5→6 crosses the bracket)', () => {
    expect(groupSizeBracketPrice(PRICES, 6)).toEqual({ pricePerPerson: 1100, basis: 'tier_6_plus' })
    expect(groupSizeBracketPrice(PRICES, 12)).toEqual({ pricePerPerson: 1100, basis: 'tier_6_plus' })
  })
})

describe('quoteCheckout (live display quote — server re-resolves + snapshots at create)', () => {
  it('computes gross = pricePerPerson × count', () => {
    expect(quoteCheckout(PRICES, 2, false).gross).toBe(3000)
    expect(quoteCheckout(PRICES, 3, false).gross).toBe(3900) // 1300 × 3, bracket switched
    expect(quoteCheckout(PRICES, 6, false).gross).toBe(6600) // 1100 × 6
  })
  it('partial-pay advance is floor(25% of gross) with the balance as the remainder', () => {
    const q = quoteCheckout(PRICES, 3, true) // gross 3900
    expect(q.advance).toBe(975) // floor(3900 * 0.25)
    expect(q.balance).toBe(2925)
    expect(q.advance + q.balance).toBe(q.gross)
  })
  it('full-upfront charges the whole gross now (advance = gross, balance = 0)', () => {
    const q = quoteCheckout(PRICES, 2, false)
    expect(q.advance).toBe(3000)
    expect(q.balance).toBe(0)
  })
})
