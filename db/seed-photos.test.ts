import { describe, expect, it } from 'vitest'

import { galleryFor } from '@/db/seed-photos'

describe('galleryFor (deterministic per-listing gallery)', () => {
  it('returns 6 distinct photo IDs for a listing', () => {
    const ids = galleryFor('paragliding', 'some-listing-slug')
    expect(ids.length).toBe(6)
    expect(new Set(ids).size).toBe(6)
  })

  it('is stable for the same (activity, key)', () => {
    expect(galleryFor('rafting', 'abc')).toEqual(galleryFor('rafting', 'abc'))
  })

  it('gives two same-activity sibling listings DIFFERENT covers', () => {
    const a = galleryFor('paragliding', 'manali-solang-paragliding-tandem')
    const b = galleryFor('paragliding', 'bir-billing-paragliding-full-day')
    expect(a[0]).not.toBe(b[0])
  })

  it('draws only from the curated activity pool', () => {
    const ids = galleryFor('scuba-diving', 'goa-scuba-x')
    for (const id of ids) expect(id).toMatch(/^photo-/)
  })
})
