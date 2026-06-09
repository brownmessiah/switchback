import { describe, expect, it } from 'vitest'

import { deriveActiveFilterChips } from './active-filter-chips'

describe('deriveActiveFilterChips (issue 10)', () => {
  it('returns no chips when no filter params are set', () => {
    expect(deriveActiveFilterChips({})).toEqual([])
    // `q` and `sort` are not removable filter chips (q is the search query, sort
    // is an ordering, not a result-narrowing filter).
    expect(deriveActiveFilterChips({ q: 'rafting', sort: 'price_asc' })).toEqual([])
  })

  it('derives one chip per applied filter with a stable key + removeParams', () => {
    const chips = deriveActiveFilterChips({ activity: 'rafting' })
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({
      key: 'activity',
      kind: 'activity',
      value: 'rafting',
      removeParams: ['activity'],
    })
  })

  it('derives a chip for every legacy + structured + trust filter', () => {
    const chips = deriveActiveFilterChips({
      category: 'water',
      state: 'Goa',
      region: 'rishikesh',
      activity: 'rafting',
      difficulty: 'moderate',
      durationBand: 'half_day',
      seasonMonth: 6,
      maxGroupSize: 8,
      minRating: 4,
      safetyVerified: true,
      cancellation: 'flexible',
    })
    expect(chips.map((c) => c.kind)).toEqual([
      'category',
      'state',
      'region',
      'activity',
      'difficulty',
      'durationBand',
      'season',
      'groupSize',
      'rating',
      'safety',
      'cancellation',
    ])
  })

  it('renders the price range as a SINGLE chip that removes both bounds', () => {
    const chips = deriveActiveFilterChips({ minPrice: 1000, maxPrice: 5000 })
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({
      key: 'price',
      kind: 'price',
      removeParams: ['minPrice', 'maxPrice'],
    })
    // The min + max are carried so the UI can format "₹1000 – ₹5000".
    expect(chips[0]!.priceMin).toBe(1000)
    expect(chips[0]!.priceMax).toBe(5000)
  })

  it('renders a price chip for a min-only or max-only bound', () => {
    expect(deriveActiveFilterChips({ minPrice: 1000 })[0]).toMatchObject({
      kind: 'price',
      priceMin: 1000,
      priceMax: undefined,
      removeParams: ['minPrice', 'maxPrice'],
    })
    expect(deriveActiveFilterChips({ maxPrice: 5000 })[0]).toMatchObject({
      kind: 'price',
      priceMin: undefined,
      priceMax: 5000,
    })
  })

  it('renders the rating chip carrying the numeric threshold', () => {
    const chips = deriveActiveFilterChips({ minRating: 4 })
    expect(chips[0]).toMatchObject({
      key: 'minRating',
      kind: 'rating',
      ratingValue: 4,
      removeParams: ['minRating'],
    })
  })

  it('renders the safety chip ONLY when safetyVerified is true', () => {
    expect(deriveActiveFilterChips({ safetyVerified: true })).toHaveLength(1)
    expect(deriveActiveFilterChips({ safetyVerified: true })[0]).toMatchObject({
      key: 'safetyVerified',
      kind: 'safety',
      removeParams: ['safetyVerified'],
    })
    expect(deriveActiveFilterChips({ safetyVerified: false })).toEqual([])
  })

  it('renders the flexible-cancellation chip', () => {
    const chips = deriveActiveFilterChips({ cancellation: 'flexible' })
    expect(chips[0]).toMatchObject({
      key: 'cancellation',
      kind: 'cancellation',
      value: 'flexible',
      removeParams: ['cancellation'],
    })
  })

  it('carries the season month + group size as numbers', () => {
    expect(deriveActiveFilterChips({ seasonMonth: 6 })[0]).toMatchObject({
      kind: 'season',
      seasonMonth: 6,
      removeParams: ['season'],
    })
    expect(deriveActiveFilterChips({ maxGroupSize: 8 })[0]).toMatchObject({
      kind: 'groupSize',
      groupSize: 8,
      removeParams: ['groupSize'],
    })
  })
})
