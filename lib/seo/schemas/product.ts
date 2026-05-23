export interface ProductArgs {
  name: string
  url: string
  description: string
  priceRupees: number
  image?: string
  ratingValue?: number
  ratingCount?: number
}

interface OfferBlock {
  '@type': 'Offer'
  price: string
  priceCurrency: 'INR'
  availability: 'https://schema.org/InStock'
}

interface AggregateRatingBlock {
  '@type': 'AggregateRating'
  ratingValue: number
  ratingCount: number
}

export interface ProductJsonLd {
  '@context': 'https://schema.org'
  '@type': 'Product'
  name: string
  url: string
  description: string
  image?: string
  offers: OfferBlock
  aggregateRating?: AggregateRatingBlock
}

export function product(args: ProductArgs): ProductJsonLd {
  if (!args.name.trim()) throw new Error('product name must be non-empty')
  if (!args.url.trim()) throw new Error('product url must be non-empty')

  const result: ProductJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: args.name,
    url: args.url,
    description: args.description,
    offers: {
      '@type': 'Offer',
      price: String(args.priceRupees),
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
    },
  }

  if (args.image) {
    result.image = args.image
  }

  if (
    typeof args.ratingValue === 'number' &&
    typeof args.ratingCount === 'number'
  ) {
    result.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: args.ratingValue,
      ratingCount: args.ratingCount,
    }
  }

  return result
}
