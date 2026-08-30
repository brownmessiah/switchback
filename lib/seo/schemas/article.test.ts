import { describe, expect, it } from 'vitest'

import { article, type ArticleArgs } from './article'

describe('Article JSON-LD (ADR-0013)', () => {
  const base: ArticleArgs = {
    headline: 'Rishikesh Rafting Grades, Explained',
    url: 'https://outvers.in/blog/rishikesh-rafting-grades-explained',
    datePublished: '2026-05-01',
    authorName: 'Switchback Editorial',
  }

  it('generates a valid Article schema with required fields', () => {
    const result = article(base)
    expect(result['@context']).toBe('https://schema.org')
    expect(result['@type']).toBe('Article')
    expect(result.headline).toBe('Rishikesh Rafting Grades, Explained')
    expect(result.url).toBe('https://outvers.in/blog/rishikesh-rafting-grades-explained')
    expect(result.datePublished).toBe('2026-05-01')
    expect(result.author).toEqual({ '@type': 'Person', name: 'Switchback Editorial' })
  })

  it('includes image + description + dateModified when provided', () => {
    const result = article({
      ...base,
      image: 'https://cdn/cover.jpg',
      description: 'What Grade III+ means.',
      dateModified: '2026-05-10',
    })
    expect(result.image).toBe('https://cdn/cover.jpg')
    expect(result.description).toBe('What Grade III+ means.')
    expect(result.dateModified).toBe('2026-05-10')
  })

  it('omits optional fields when not provided', () => {
    const result = article(base)
    expect(result.image).toBeUndefined()
    expect(result.description).toBeUndefined()
    expect(result.dateModified).toBeUndefined()
  })

  it('throws on empty headline or url', () => {
    expect(() => article({ ...base, headline: '' })).toThrow()
    expect(() => article({ ...base, url: '' })).toThrow()
  })
})
