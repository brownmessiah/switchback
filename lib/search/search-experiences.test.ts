import { describe, expect, it } from 'vitest'

import { buildMeiliFilter } from './search-experiences'

describe('buildMeiliFilter (Task 23)', () => {
  it('returns empty string when no filters are active', () => {
    expect(buildMeiliFilter({})).toBe('')
  })

  it('filters by activity slug', () => {
    expect(buildMeiliFilter({ activity: 'rafting' })).toBe(
      'activitySlug = "rafting"',
    )
  })

  it('filters by region slug', () => {
    expect(buildMeiliFilter({ region: 'rishikesh' })).toBe(
      'regionSlug = "rishikesh"',
    )
  })

  it('filters by min price', () => {
    expect(buildMeiliFilter({ minPrice: 1000 })).toBe(
      'pricePerPersonRupees >= 1000',
    )
  })

  it('filters by max price', () => {
    expect(buildMeiliFilter({ maxPrice: 5000 })).toBe(
      'pricePerPersonRupees <= 5000',
    )
  })

  it('combines multiple filters with AND', () => {
    const filter = buildMeiliFilter({
      activity: 'rafting',
      region: 'rishikesh',
      minPrice: 1000,
      maxPrice: 5000,
    })
    expect(filter).toBe(
      'activitySlug = "rafting" AND regionSlug = "rishikesh" AND pricePerPersonRupees >= 1000 AND pricePerPersonRupees <= 5000',
    )
  })

  it('ignores undefined values', () => {
    const filter = buildMeiliFilter({
      activity: undefined,
      region: 'goa',
    })
    expect(filter).toBe('regionSlug = "goa"')
  })
})

describe('isFilteredSearch', () => {
  it('returns true when any filter param is set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ activity: 'rafting' })).toBe(true)
    expect(isFilteredSearch({ minPrice: 1000 })).toBe(true)
    expect(isFilteredSearch({ sort: 'price_asc' })).toBe(true)
  })

  it('returns false when only q is set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({ q: 'rafting' })).toBe(false)
  })

  it('returns false when no params are set', async () => {
    const { isFilteredSearch } = await import('./search-experiences')
    expect(isFilteredSearch({})).toBe(false)
  })
})
