import { describe, expect, it } from 'vitest'

import { getActivityImage, getActivityPhotoIds } from '@/lib/images'

// The mis-tagged Unsplash ID that used to be served as "paragliding" but is
// actually a photo of a jigsaw puzzle. It must never resolve again.
const PUZZLE_ID = 'photo-1597400473366-371a80b251eb'

const ACTIVITIES = [
  'rafting',
  'paragliding',
  'scuba-diving',
  'trekking',
  'kayaking',
  'camping',
  'skiing',
  'bungee-jumping',
  'rock-climbing',
  'safari',
] as const

describe('getActivityPhotoIds (curated on-subject pools)', () => {
  it('returns >= 6 distinct photo IDs for every known activity', () => {
    for (const slug of ACTIVITIES) {
      const ids = getActivityPhotoIds(slug)
      expect(ids.length, slug).toBeGreaterThanOrEqual(6)
      expect(new Set(ids).size, slug).toBe(ids.length) // all distinct
      for (const id of ids) expect(id, `${slug}:${id}`).toMatch(/^photo-/)
    }
  })

  it('no longer contains the mis-tagged puzzle photo under paragliding', () => {
    expect(getActivityPhotoIds('paragliding')).not.toContain(PUZZLE_ID)
  })
})

describe('getActivityImage', () => {
  it('resolves paragliding to an on-subject photo, not the puzzle', () => {
    expect(getActivityImage('paragliding')).not.toContain(PUZZLE_ID)
  })

  it('returns three DISTINCT photos for variants 0/1/2 (no crop-dupes)', () => {
    const tiles = [0, 1, 2].map((v) => getActivityImage('paragliding', v))
    expect(new Set(tiles).size).toBe(3)
  })

  it('falls back to a generic landscape for an unknown activity', () => {
    expect(getActivityImage('not-a-real-activity')).toMatch(/^https:\/\/images\.unsplash\.com\//)
  })
})
