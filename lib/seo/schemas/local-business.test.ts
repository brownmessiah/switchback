import { describe, expect, it } from 'vitest'

import { vendorEntity, type VendorEntityArgs } from './local-business'

describe('Vendor entity JSON-LD (ADR-0013)', () => {
  const base: VendorEntityArgs = {
    name: 'Himalayan Rafting Co.',
    url: 'https://switchback.com/vendor/himalayan-rafting-co',
    kycTier: 'business',
  }

  it('emits LocalBusiness for a Business-verified Vendor (KYC tier 3)', () => {
    const result = vendorEntity(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('LocalBusiness')
    expect(result.name).toBe('Himalayan Rafting Co.')
    expect(result.url).toBe('https://switchback.com/vendor/himalayan-rafting-co')
  })

  it('emits Organization for an identity-tier Vendor (lower tier)', () => {
    const result = vendorEntity({ ...base, kycTier: 'identity' })
    expect(result['@type']).toBe('Organization')
  })

  it('emits Organization for a phone-tier Vendor (lowest tier)', () => {
    const result = vendorEntity({ ...base, kycTier: 'phone' })
    expect(result['@type']).toBe('Organization')
  })

  it('never emits LocalBusiness below the Business tier', () => {
    expect(vendorEntity({ ...base, kycTier: 'identity' })['@type']).not.toBe(
      'LocalBusiness',
    )
    expect(vendorEntity({ ...base, kycTier: 'phone' })['@type']).not.toBe(
      'LocalBusiness',
    )
  })

  it('includes aggregateRating only when real published reviews exist (D0)', () => {
    const result = vendorEntity({
      ...base,
      ratingValue: 4.7,
      ratingCount: 23,
    })
    expect(result.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.7,
      ratingCount: 23,
    })
  })

  it('omits aggregateRating when there are no reviews', () => {
    const result = vendorEntity(base)
    expect(result.aggregateRating).toBeUndefined()
  })

  it('omits aggregateRating when the review count is zero (no fabricated ratings)', () => {
    const result = vendorEntity({ ...base, ratingValue: 0, ratingCount: 0 })
    expect(result.aggregateRating).toBeUndefined()
  })

  it('throws on empty name', () => {
    expect(() => vendorEntity({ ...base, name: '' })).toThrow()
  })

  it('throws on empty url', () => {
    expect(() => vendorEntity({ ...base, url: '' })).toThrow()
  })
})
