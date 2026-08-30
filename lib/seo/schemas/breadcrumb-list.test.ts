import { describe, expect, it } from 'vitest'

import { breadcrumbList } from './breadcrumb-list'

describe('breadcrumbList JSON-LD', () => {
  it('emits a schema.org BreadcrumbList with positioned items', () => {
    const json = breadcrumbList([
      { name: 'Home', url: 'https://switchback.com/' },
      { name: 'Adventure', url: 'https://switchback.com/adventure' },
      { name: 'Rafting in Rishikesh', url: 'https://switchback.com/adventure/rafting-in-rishikesh' },
    ])
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('BreadcrumbList')
    expect(json.itemListElement).toHaveLength(3)
    expect(json.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://switchback.com/',
    })
    expect(json.itemListElement[2]?.position).toBe(3)
  })

  it('throws on empty crumbs', () => {
    expect(() => breadcrumbList([])).toThrow(/at least one/i)
  })
})
