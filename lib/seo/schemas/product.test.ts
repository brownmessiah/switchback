import { describe, expect, it } from 'vitest'

import { product, type ProductArgs } from './product'

describe('Product JSON-LD (ADR-0013)', () => {
  const base: ProductArgs = {
    name: 'Grand Rafting Trip',
    url: 'https://switchback.com/en/experience/grand-rafting-trip',
    description: 'A thrilling rafting experience in Rishikesh',
    priceRupees: 2500,
  }

  it('generates a valid Product schema with required fields', () => {
    const result = product(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Product')
    expect(result.name).toBe('Grand Rafting Trip')
    expect(result.url).toBe('https://switchback.com/en/experience/grand-rafting-trip')
    expect(result.description).toBe('A thrilling rafting experience in Rishikesh')
    expect(result.offers['@type']).toBe('Offer')
    expect(result.offers.price).toBe('2500')
    expect(result.offers.priceCurrency).toBe('INR')
    expect(result.offers.availability).toBe('https://schema.org/InStock')
  })

  it('includes image when provided', () => {
    const result = product({ ...base, image: 'https://switchback.com/img/raft.jpg' })
    expect(result.image).toBe('https://switchback.com/img/raft.jpg')
  })

  it('omits image when not provided', () => {
    const result = product(base)
    expect(result.image).toBeUndefined()
  })

  it('includes aggregateRating when both value and count are provided', () => {
    const result = product({ ...base, ratingValue: 4.5, ratingCount: 120 })
    expect(result.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.5,
      ratingCount: 120,
    })
  })

  it('omits aggregateRating when not provided (M2: no reviews yet)', () => {
    const result = product(base)
    expect(result.aggregateRating).toBeUndefined()
  })

  it('throws on empty name', () => {
    expect(() => product({ ...base, name: '' })).toThrow()
  })

  it('throws on empty url', () => {
    expect(() => product({ ...base, url: '' })).toThrow()
  })
})
