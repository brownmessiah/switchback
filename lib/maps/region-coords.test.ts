import { describe, expect, it } from 'vitest'

import { listRegions } from '@/lib/regions/registry'

import { getRegionCoords, hasRegionCoords } from './region-coords'

/**
 * Issue 11 — region centroid lookup (coordinate honesty, D0).
 *
 * These are REAL, public, well-known city-centroid coordinates keyed by region
 * slug — NOT fabricated per-Experience precision. The map is a city-level
 * discovery map: every Experience in a region pins to its region centroid.
 */
describe('region centroid coords', () => {
  it('returns real lat/lng for a known region slug', () => {
    const coords = getRegionCoords('rishikesh')
    expect(coords).toBeDefined()
    // Rishikesh is ~30.10 N, 78.29 E — assert it is in the right ballpark
    // (a sanity band, not a fabricated-precision check).
    expect(coords?.lat).toBeGreaterThan(29)
    expect(coords?.lat).toBeLessThan(31)
    expect(coords?.lng).toBeGreaterThan(77)
    expect(coords?.lng).toBeLessThan(79)
  })

  it('returns undefined for an unknown region slug', () => {
    expect(getRegionCoords('atlantis')).toBeUndefined()
    expect(getRegionCoords('')).toBeUndefined()
  })

  it('hasRegionCoords narrows known slugs', () => {
    expect(hasRegionCoords('goa')).toBe(true)
    expect(hasRegionCoords('atlantis')).toBe(false)
  })

  it('covers every region in the registry with India-bounded coords', () => {
    // Every registered region must have a centroid so no Experience is silently
    // dropped from the map for lack of a known city. India's bounding box is
    // roughly lat 6–37 N, lng 68–98 E.
    for (const region of listRegions()) {
      const coords = getRegionCoords(region.slug)
      expect(coords, `missing centroid for ${region.slug}`).toBeDefined()
      expect(coords!.lat).toBeGreaterThan(6)
      expect(coords!.lat).toBeLessThan(37)
      expect(coords!.lng).toBeGreaterThan(68)
      expect(coords!.lng).toBeLessThan(98)
    }
  })
})
