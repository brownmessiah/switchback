import { describe, expect, it } from 'vitest'

import { reviewList, type ReviewItem } from './review'

describe('Review JSON-LD (ADR-0013)', () => {
  const items: ReviewItem[] = [
    {
      author: 'Asha K.',
      rating: 5,
      title: 'Best adventure ever!',
      body: 'Fantastic guides and views.',
      datePublished: new Date('2026-04-01T00:00:00.000Z'),
    },
    {
      author: 'Ravi P.',
      rating: 4,
      title: null,
      body: 'Great, minor delays.',
      datePublished: new Date('2026-04-10T00:00:00.000Z'),
    },
  ]

  it('generates one Review schema per review with required fields', () => {
    const result = reviewList(items)
    expect(result).toHaveLength(2)

    const first = result[0]
    expect(first['@context']).toBe('https://schema.org')
    expect(first['@type']).toBe('Review')
    expect(first.author).toEqual({ '@type': 'Person', name: 'Asha K.' })
    expect(first.reviewRating).toEqual({
      '@type': 'Rating',
      ratingValue: 5,
      bestRating: 5,
      worstRating: 1,
    })
    expect(first.name).toBe('Best adventure ever!')
    expect(first.reviewBody).toBe('Fantastic guides and views.')
    expect(first.datePublished).toBe('2026-04-01')
  })

  it('omits name when the review has no title', () => {
    const result = reviewList(items)
    expect(result[1].name).toBeUndefined()
  })

  it('returns an empty array for no reviews', () => {
    expect(reviewList([])).toEqual([])
  })

  it('falls back to "Customer" when author name is blank', () => {
    const result = reviewList([{ ...items[0], author: '' }])
    expect(result[0].author.name).toBe('Customer')
  })
})
