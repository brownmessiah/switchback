import { describe, expect, it } from 'vitest'

import { hasAtLeastOnePrice } from './listing-price-validation'

/**
 * The KEY rule for issue #08: an Experience must carry at least one price — a
 * positive base (1-2 bracket) price OR ≥1 ACTIVE pricing variation. A listing
 * with no base price and only INACTIVE variations is BLOCKED.
 *
 * Pure validator (no DB) so the create + edit Zod schemas and the form can all
 * enforce the same rule.
 */
describe('hasAtLeastOnePrice', () => {
  it('allows a positive base price with no variations', () => {
    expect(hasAtLeastOnePrice({ basePrice: 2500, variations: [] })).toBe(true)
  })

  it('allows ONE active variation with no base price', () => {
    expect(
      hasAtLeastOnePrice({
        basePrice: 0,
        variations: [{ pricePerPerson: '1800.00', isActive: true }],
      }),
    ).toBe(true)
  })

  it('allows a positive base price even when every variation is inactive', () => {
    expect(
      hasAtLeastOnePrice({
        basePrice: 2500,
        variations: [{ pricePerPerson: '1800.00', isActive: false }],
      }),
    ).toBe(true)
  })

  it('BLOCKS no base price and only INACTIVE variations', () => {
    expect(
      hasAtLeastOnePrice({
        basePrice: 0,
        variations: [
          { pricePerPerson: '1800.00', isActive: false },
          { pricePerPerson: '2200.00', isActive: false },
        ],
      }),
    ).toBe(false)
  })

  it('BLOCKS an empty listing (no base, no variations)', () => {
    expect(hasAtLeastOnePrice({ basePrice: 0, variations: [] })).toBe(false)
  })

  it('treats a NaN / non-positive base as no base', () => {
    expect(hasAtLeastOnePrice({ basePrice: Number.NaN, variations: [] })).toBe(false)
    expect(hasAtLeastOnePrice({ basePrice: -100, variations: [] })).toBe(false)
  })

  it('ignores an active variation whose price is not positive', () => {
    // An active variation priced 0 is not a usable price — it must not satisfy
    // the rule on its own.
    expect(
      hasAtLeastOnePrice({
        basePrice: 0,
        variations: [{ pricePerPerson: '0', isActive: true }],
      }),
    ).toBe(false)
  })

  it('accepts a string base price (form sends raw input strings)', () => {
    expect(hasAtLeastOnePrice({ basePrice: '2500', variations: [] })).toBe(true)
    expect(hasAtLeastOnePrice({ basePrice: '', variations: [] })).toBe(false)
  })
})
