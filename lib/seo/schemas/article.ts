export interface ArticleArgs {
  headline: string
  url: string
  /** ISO-8601 date (YYYY-MM-DD or full timestamp). */
  datePublished: string
  authorName: string
  image?: string
  description?: string
  dateModified?: string
}

interface AuthorBlock {
  '@type': 'Person'
  name: string
}

export interface ArticleJsonLd {
  '@context': 'https://schema.org'
  '@type': 'Article'
  headline: string
  url: string
  datePublished: string
  author: AuthorBlock
  image?: string
  description?: string
  dateModified?: string
}

/**
 * schema.org/Article JSON-LD for the public blog reader (ADR-0013).
 */
export function article(args: ArticleArgs): ArticleJsonLd {
  if (!args.headline.trim()) throw new Error('article headline must be non-empty')
  if (!args.url.trim()) throw new Error('article url must be non-empty')

  const result: ArticleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: args.headline,
    url: args.url,
    datePublished: args.datePublished,
    author: { '@type': 'Person', name: args.authorName },
  }
  if (args.image) result.image = args.image
  if (args.description) result.description = args.description
  if (args.dateModified) result.dateModified = args.dateModified
  return result
}
