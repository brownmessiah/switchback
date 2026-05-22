/**
 * ItemList of Product entries JSON-LD per ADR-0013. The shape Google
 * needs to render rich-result product carousels on an activity-city
 * collection page.
 *
 * Each item is a Product with offers (price + INR + availability) and
 * optional AggregateRating. Items without ratings simply omit the
 * AggregateRating block — Google tolerates missing aggregateRating but
 * not malformed values.
 *
 * Money is integer rupees on the input; we stringify to the
 * schema.org price field (string-typed per spec). Currency is INR
 * (ISO 4217).
 */

export interface ItemListProduct {
  name: string
  url: string
  image?: string
  priceRupees: number
  /** Average review rating 0..5. Omit when no reviews are available. */
  ratingValue?: number
  ratingCount?: number
}

export interface ItemListArgs {
  name: string
  items: ItemListProduct[]
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

interface ProductBlock {
  '@type': 'Product'
  name: string
  url: string
  image?: string
  offers: OfferBlock
  aggregateRating?: AggregateRatingBlock
}

export interface ItemListJsonLd {
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  name: string
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    item: ProductBlock
  }>
}

export function itemList(args: ItemListArgs): ItemListJsonLd {
  if (args.items.length === 0) {
    throw new Error('itemList requires at least one item')
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: args.name,
    itemListElement: args.items.map((item, index) => {
      const product: ProductBlock = {
        '@type': 'Product',
        name: item.name,
        url: item.url,
        offers: {
          '@type': 'Offer',
          price: String(item.priceRupees),
          priceCurrency: 'INR',
          availability: 'https://schema.org/InStock',
        },
      }
      if (item.image) {
        product.image = item.image
      }
      if (
        typeof item.ratingValue === 'number' &&
        typeof item.ratingCount === 'number'
      ) {
        product.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: item.ratingValue,
          ratingCount: item.ratingCount,
        }
      }
      return {
        '@type': 'ListItem',
        position: index + 1,
        item: product,
      }
    }),
  }
}
