import { describe, expect, it } from 'vitest'

import {
  REVIEW_GROUP_TYPES,
  REVIEW_SORTS,
  deriveTravelMonth,
  filterWithPhotos,
  hasApprovedPhotos,
  isPublished,
  sortReviews,
  type EnrichedReview,
  type ReviewGroupType,
  type ReviewSort,
} from './enrichment'

function makeReview(over: Partial<EnrichedReview>): EnrichedReview {
  return {
    id: 'r1',
    rating: 5,
    title: null,
    body: null,
    customerName: 'Asha',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    status: 'published',
    travelMonth: null,
    groupType: null,
    photos: [],
    ...over,
  }
}

describe('deriveTravelMonth', () => {
  it('returns the 1-based month index from a slot start_at', () => {
    // 2026-06-15 → June → 6
    expect(deriveTravelMonth(new Date('2026-06-15T09:30:00Z'))).toBe(6)
  })

  it('returns 1 for January and 12 for December', () => {
    expect(deriveTravelMonth(new Date('2026-01-02T00:00:00Z'))).toBe(1)
    expect(deriveTravelMonth(new Date('2026-12-15T12:00:00Z'))).toBe(12)
  })

  it('returns null when there is no slot date', () => {
    expect(deriveTravelMonth(null)).toBeNull()
    expect(deriveTravelMonth(undefined)).toBeNull()
  })

  it('derives the month in IST so a late-evening UTC slot keeps its local month', () => {
    // 2026-06-30T20:00Z = 2026-07-01T01:30 IST → July (7), the traveller's
    // local month, not the UTC month (6).
    expect(deriveTravelMonth(new Date('2026-06-30T20:00:00Z'))).toBe(7)
  })
})

describe('isPublished', () => {
  it('passes only published reviews', () => {
    const set = [
      makeReview({ id: 'a', status: 'published' }),
      makeReview({ id: 'b', status: 'pending' }),
      makeReview({ id: 'c', status: 'flagged' }),
      makeReview({ id: 'd', status: 'removed' }),
      makeReview({ id: 'e', status: 'published' }),
    ]
    expect(set.filter(isPublished).map((r) => r.id)).toEqual(['a', 'e'])
  })
})

describe('sortReviews', () => {
  const older = makeReview({
    id: 'older',
    rating: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
  const mid = makeReview({
    id: 'mid',
    rating: 5,
    createdAt: new Date('2026-03-01T00:00:00Z'),
  })
  const newer = makeReview({
    id: 'newer',
    rating: 1,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  })
  const input = [older, newer, mid]

  it('recent → newest createdAt first', () => {
    expect(sortReviews(input, 'recent').map((r) => r.id)).toEqual([
      'newer',
      'mid',
      'older',
    ])
  })

  it('highest → highest rating first', () => {
    expect(sortReviews(input, 'highest').map((r) => r.id)).toEqual([
      'mid',
      'older',
      'newer',
    ])
  })

  it('lowest → lowest rating first', () => {
    expect(sortReviews(input, 'lowest').map((r) => r.id)).toEqual([
      'newer',
      'older',
      'mid',
    ])
  })

  it('does not mutate the input array', () => {
    const copy = [...input]
    sortReviews(input, 'highest')
    expect(input).toEqual(copy)
  })

  it('breaks ties deterministically by recency (highest)', () => {
    const a = makeReview({
      id: 'a',
      rating: 4,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    })
    const b = makeReview({
      id: 'b',
      rating: 4,
      createdAt: new Date('2026-05-01T00:00:00Z'),
    })
    expect(sortReviews([a, b], 'highest').map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('with-photos filter', () => {
  const withPhoto = makeReview({
    id: 'with',
    photos: [{ id: 'p1', url: '/uploads/reviews/p1.jpg', altText: null }],
  })
  const without = makeReview({ id: 'without', photos: [] })

  it('hasApprovedPhotos is true only when a review has >=1 photo', () => {
    expect(hasApprovedPhotos(withPhoto)).toBe(true)
    expect(hasApprovedPhotos(without)).toBe(false)
  })

  it('filterWithPhotos returns only reviews with >=1 photo', () => {
    expect(filterWithPhotos([withPhoto, without]).map((r) => r.id)).toEqual([
      'with',
    ])
  })

  it('filterWithPhotos does not mutate the input array', () => {
    const input = [withPhoto, without]
    const copy = [...input]
    filterWithPhotos(input)
    expect(input).toEqual(copy)
  })
})

describe('vocabulary constants', () => {
  it('exposes the five capture-time group types', () => {
    expect([...REVIEW_GROUP_TYPES]).toEqual([
      'solo',
      'couple',
      'friends',
      'family',
      'corporate',
    ])
  })

  it('exposes the three sort modes', () => {
    expect([...REVIEW_SORTS]).toEqual(['recent', 'highest', 'lowest'])
  })

  it('group types and sorts are usable as types', () => {
    const g: ReviewGroupType = 'family'
    const s: ReviewSort = 'lowest'
    expect(REVIEW_GROUP_TYPES).toContain(g)
    expect(REVIEW_SORTS).toContain(s)
  })
})
