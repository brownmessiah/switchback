import { describe, expect, it } from 'vitest'

import { itemList } from './item-list'

describe('itemList JSON-LD', () => {
  it('emits an ItemList of Product entries with positions, URLs, and offer prices in INR', () => {
    const json = itemList({
      name: 'Top Rafting Experiences in Rishikesh',
      items: [
        {
          name: 'Grand Rafting Adventure',
          url: 'https://outvers.com/experience/grand-rafting',
          image: 'https://cdn.outvers.com/img/grand-rafting.jpg',
          priceRupees: 1500,
          ratingValue: 4.7,
          ratingCount: 132,
        },
        {
          name: 'Easy Day Rafting',
          url: 'https://outvers.com/experience/easy-rafting',
          image: 'https://cdn.outvers.com/img/easy-rafting.jpg',
          priceRupees: 800,
        },
      ],
    })
    expect(json['@context']).toBe('https://schema.org')
    expect(json['@type']).toBe('ItemList')
    expect(json.name).toBe('Top Rafting Experiences in Rishikesh')
    expect(json.itemListElement).toHaveLength(2)
    expect(json.itemListElement[0]).toMatchObject({
      '@type': 'ListItem',
      position: 1,
      item: {
        '@type': 'Product',
        name: 'Grand Rafting Adventure',
        url: 'https://outvers.com/experience/grand-rafting',
        image: 'https://cdn.outvers.com/img/grand-rafting.jpg',
        offers: {
          '@type': 'Offer',
          price: '1500',
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: 4.7,
          ratingCount: 132,
        },
      },
    })
    // Second item has no rating — aggregateRating omitted
    expect(json.itemListElement[1]?.item.aggregateRating).toBeUndefined()
  })

  it('throws on empty items', () => {
    expect(() => itemList({ name: 'x', items: [] })).toThrow(/at least one/i)
  })
})
