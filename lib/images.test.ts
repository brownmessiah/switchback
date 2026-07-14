import { describe, expect, it } from 'vitest'

import {
  getActivityImage,
  getActivityPhotoIds,
  getHeroImage,
  getHeroImages,
} from '@/lib/images'

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

describe('getHeroImages (auto-rotating hero pool — home-redesign issue 04)', () => {
  it('returns >= 4 distinct adventure hero URLs', () => {
    const pool = getHeroImages()
    expect(pool.length).toBeGreaterThanOrEqual(4)
    expect(new Set(pool).size).toBe(pool.length)
    for (const url of pool) {
      expect(url).toMatch(/^https:\/\/images\.unsplash\.com\/photo-/)
    }
  })

  it('uses the hero crop (1600x900) for every pool image', () => {
    for (const url of getHeroImages()) {
      expect(url).toContain('w=1600')
      expect(url).toContain('h=900')
    }
  })

  it('keeps getHeroImage() as the FIRST pool entry (LCP/priority contract)', () => {
    // The first frame is the preloaded LCP image; rotation starts after
    // mount. getHeroImage() must stay in lockstep so nothing regresses if a
    // caller still asks for the single hero.
    expect(getHeroImages()[0]).toBe(getHeroImage())
  })

  it('slide 0 IS the long-standing canonical hero photo (SSR/LCP frame pinned)', () => {
    // Not circular like the lockstep check above: reordering HERO_PHOTO_IDS
    // would silently swap the preloaded first frame. Pin the id.
    expect(getHeroImage()).toContain('photo-1530866495561-507c9faab2ed')
  })

  it('every non-first pool image comes from a visually-verified activity pool', () => {
    // The historical failure mode was hand-typed unsplash IDs that turned
    // out off-subject. Enforce the docstring guarantee: rotation frames are
    // drawn from the curated, eyeballed activity pools only.
    const verified = new Set(
      ['rafting', 'paragliding', 'trekking', 'scuba-diving'].flatMap((slug) =>
        getActivityPhotoIds(slug),
      ),
    )
    for (const url of getHeroImages().slice(1)) {
      const id = url.match(/photo-[\w-]+/)?.[0] ?? ''
      expect(verified.has(id), `${id} not in a verified activity pool`).toBe(true)
    }
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
