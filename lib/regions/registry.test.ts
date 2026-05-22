import { describe, expect, it } from 'vitest'

import {
  getRegion,
  isRegionSlug,
  listRegions,
} from './registry'

describe('regions registry', () => {
  it('lists every region exactly once with stable slug + display names', () => {
    const regions = listRegions()
    const slugs = regions.map((r) => r.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const region of regions) {
      expect(region.slug).toMatch(/^[a-z0-9-]+$/)
      expect(region.displayName.en).toBeTruthy()
    }
  })

  it('returns canonical region metadata by slug', () => {
    const r = getRegion('rishikesh')
    expect(r).toBeDefined()
    expect(r?.displayName.en).toBe('Rishikesh')
    expect(r?.state).toBe('Uttarakhand')
  })

  it('returns undefined for unknown slugs', () => {
    expect(getRegion('atlantis')).toBeUndefined()
  })

  it('isRegionSlug narrows the type for known slugs', () => {
    expect(isRegionSlug('rishikesh')).toBe(true)
    expect(isRegionSlug('atlantis')).toBe(false)
    expect(isRegionSlug('')).toBe(false)
  })

  it('includes the highest-volume launch destinations from ADR-0013', () => {
    const slugs = new Set(listRegions().map((r) => r.slug))
    expect(slugs.has('rishikesh')).toBe(true) // rafting
    expect(slugs.has('bir-billing')).toBe(true) // paragliding
    expect(slugs.has('goa')).toBe(true) // scuba
    expect(slugs.has('manali')).toBe(true) // trekking
  })
})
