import { describe, expect, it } from 'vitest'

import { toMapPin, toMapPins, type PinnableExperience } from './pins'

/**
 * Issue 11 — pure pin transform.
 *
 * Experience + region centroid → {lat,lng,price,activity,slug,title}. The
 * transform is pure (no React/DB/router): it resolves the region centroid and
 * the activity display name from the registries. An Experience whose region has
 * no centroid is excluded (null), handled gracefully — never a fabricated pin.
 */

const rafting: PinnableExperience = {
  slug: 'ganges-white-water',
  title: 'Ganges White-Water Rafting',
  regionSlug: 'rishikesh',
  activitySlug: 'rafting',
  pricePerPersonRupees: 1499,
}

describe('toMapPin', () => {
  it('maps an Experience to a pin at its region centroid', () => {
    const pin = toMapPin(rafting)
    expect(pin).not.toBeNull()
    expect(pin!.slug).toBe('ganges-white-water')
    expect(pin!.title).toBe('Ganges White-Water Rafting')
    expect(pin!.price).toBe(1499)
    // Rishikesh centroid band.
    expect(pin!.lat).toBeGreaterThan(29)
    expect(pin!.lat).toBeLessThan(31)
    expect(pin!.lng).toBeGreaterThan(77)
    expect(pin!.lng).toBeLessThan(79)
  })

  it('resolves the activity display name (en) from the registry', () => {
    expect(toMapPin(rafting)!.activity).toBe('Rafting')
    expect(
      toMapPin({ ...rafting, activitySlug: 'scuba-diving', regionSlug: 'goa' })!.activity,
    ).toBe('Scuba Diving')
  })

  it('carries the region slug through for grouping/links', () => {
    expect(toMapPin(rafting)!.regionSlug).toBe('rishikesh')
  })

  it('returns null when the region has no known centroid (no fabricated pin)', () => {
    const pin = toMapPin({ ...rafting, regionSlug: 'atlantis' })
    expect(pin).toBeNull()
  })

  it('falls back to the raw activity slug when the activity is unknown', () => {
    const pin = toMapPin({ ...rafting, activitySlug: 'time-travel' })
    expect(pin).not.toBeNull()
    expect(pin!.activity).toBe('time-travel')
  })

  it('is pure — does not mutate its input', () => {
    const input = { ...rafting }
    const snapshot = JSON.stringify(input)
    toMapPin(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})

describe('toMapPins', () => {
  it('transforms a list and drops Experiences without a centroid', () => {
    const pins = toMapPins([
      rafting,
      { ...rafting, slug: 'no-coords', regionSlug: 'atlantis' },
      { ...rafting, slug: 'goa-scuba', regionSlug: 'goa', activitySlug: 'scuba-diving' },
    ])
    expect(pins.map((p) => p.slug)).toEqual(['ganges-white-water', 'goa-scuba'])
  })

  it('returns an empty array for an empty input', () => {
    expect(toMapPins([])).toEqual([])
  })

  it('preserves input order for pinnable Experiences', () => {
    const pins = toMapPins([
      { ...rafting, slug: 'a' },
      { ...rafting, slug: 'b', regionSlug: 'goa' },
    ])
    expect(pins.map((p) => p.slug)).toEqual(['a', 'b'])
  })
})
