import { describe, expect, it } from 'vitest'

import { DURATION_BANDS, durationBand } from './duration-band'

describe('durationBand', () => {
  it('returns null for a null duration (bare Experience drops out of a band filter)', () => {
    expect(durationBand(null)).toBeNull()
  })

  it('buckets <= 180 minutes as upto_3h', () => {
    expect(durationBand(1)).toBe('upto_3h')
    expect(durationBand(90)).toBe('upto_3h')
    expect(durationBand(180)).toBe('upto_3h')
  })

  it('buckets 181..360 minutes as half_day', () => {
    expect(durationBand(181)).toBe('half_day')
    expect(durationBand(300)).toBe('half_day')
    expect(durationBand(360)).toBe('half_day')
  })

  it('buckets 361..1439 minutes as full_day', () => {
    expect(durationBand(361)).toBe('full_day')
    expect(durationBand(720)).toBe('full_day')
    expect(durationBand(1439)).toBe('full_day')
  })

  it('buckets >= 1440 minutes (a full day or more) as multi_day', () => {
    expect(durationBand(1440)).toBe('multi_day')
    expect(durationBand(4320)).toBe('multi_day')
  })

  it('treats a non-positive duration as null (schema CHECK forbids <= 0, but be defensive)', () => {
    expect(durationBand(0)).toBeNull()
    expect(durationBand(-30)).toBeNull()
  })

  it('exposes the canonical band values as DURATION_BANDS (facet options + i18n keys)', () => {
    expect(DURATION_BANDS).toEqual(['upto_3h', 'half_day', 'full_day', 'multi_day'])
  })
})
