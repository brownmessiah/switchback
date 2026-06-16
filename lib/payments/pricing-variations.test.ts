import { describe, expect, it } from 'vitest'

import { fromPriceRupees } from './pricing-variations'

/**
 * Pure "From ₹X" entry-price helper (ADR-0011 revision 2026-06-16, issue #07).
 * Derives the lowest active variation price for listing cards. Pure — no DB.
 * `price_per_person` is numeric(12,2) carried as a STRING (never a JS float).
 */
describe('fromPriceRupees', () => {
  it('returns the lowest active variation price as a string', () => {
    const variations = [
      { pricePerPerson: '2500.00', isActive: true },
      { pricePerPerson: '1500.00', isActive: true },
      { pricePerPerson: '3200.00', isActive: true },
    ]
    expect(fromPriceRupees(variations, '9999.00')).toBe('1500.00')
  })

  it('ignores inactive variations when picking the lowest', () => {
    const variations = [
      { pricePerPerson: '900.00', isActive: false },
      { pricePerPerson: '1500.00', isActive: true },
      { pricePerPerson: '2000.00', isActive: true },
    ]
    // 900 is the lowest overall but inactive, so the active lowest (1500) wins.
    expect(fromPriceRupees(variations, '9999.00')).toBe('1500.00')
  })

  it('returns the fallback when there are no active variations', () => {
    const variations = [
      { pricePerPerson: '900.00', isActive: false },
      { pricePerPerson: '1200.00', isActive: false },
    ]
    expect(fromPriceRupees(variations, '1100.00')).toBe('1100.00')
  })

  it('returns the fallback when the variations array is empty', () => {
    expect(fromPriceRupees([], '1100.00')).toBe('1100.00')
  })

  it('compares numerically, not lexicographically', () => {
    // Lexicographic comparison would pick '1000.00' over '900.00'; numeric
    // comparison must pick 900.
    const variations = [
      { pricePerPerson: '1000.00', isActive: true },
      { pricePerPerson: '900.00', isActive: true },
    ]
    expect(fromPriceRupees(variations, '9999.00')).toBe('900.00')
  })

  it('preserves the original string form of the lowest active variation', () => {
    // The returned value is the exact column string — no float round-trip /
    // re-formatting that could drop or add precision.
    const variations = [
      { pricePerPerson: '1499.50', isActive: true },
      { pricePerPerson: '1500.00', isActive: true },
    ]
    expect(fromPriceRupees(variations, '9999.00')).toBe('1499.50')
  })

  it('accepts a numeric fallback and returns it unchanged', () => {
    expect(fromPriceRupees([], 1100)).toBe(1100)
  })
})
