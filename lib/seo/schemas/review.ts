/**
 * Review JSON-LD per ADR-0013. Composed into Experience detail pages
 * alongside Product (with AggregateRating), FAQPage, and BreadcrumbList.
 *
 * One standalone `Review` node is emitted per published Customer review.
 * Each carries a Person author, a 1..5 Rating, and the review body. The
 * title (when present) maps to `name`; `datePublished` is an ISO date
 * (YYYY-MM-DD) so search engines can age the review.
 */

export interface ReviewItem {
  author: string
  rating: number
  title: string | null
  body: string | null
  datePublished: Date
}

export interface ReviewJsonLd {
  '@context': 'https://schema.org'
  '@type': 'Review'
  author: {
    '@type': 'Person'
    name: string
  }
  reviewRating: {
    '@type': 'Rating'
    ratingValue: number
    bestRating: 5
    worstRating: 1
  }
  name?: string
  reviewBody?: string
  datePublished: string
}

/** ISO date (YYYY-MM-DD) in UTC — stable across server timezones. */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function reviewList(items: ReviewItem[]): ReviewJsonLd[] {
  return items.map((item) => {
    const node: ReviewJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Review',
      author: {
        '@type': 'Person',
        name: item.author.trim() || 'Customer',
      },
      reviewRating: {
        '@type': 'Rating',
        ratingValue: item.rating,
        bestRating: 5,
        worstRating: 1,
      },
      datePublished: isoDate(item.datePublished),
    }

    if (item.title && item.title.trim()) {
      node.name = item.title
    }
    if (item.body && item.body.trim()) {
      node.reviewBody = item.body
    }

    return node
  })
}
