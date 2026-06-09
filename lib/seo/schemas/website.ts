/**
 * WebSite JSON-LD per ADR-0013, with a SearchAction `potentialAction`.
 *
 * Emitted ONCE on the home page so search engines can offer a sitelinks
 * search box that deep-links into Outvers' `/search?q=` query. There must be
 * exactly one WebSite node on the home page — this generator consolidates the
 * brand name, URL, and the SearchAction into a single node (no duplicate
 * WebSite/SearchAction).
 *
 * The `target` template MUST contain the `{search_term_string}` placeholder
 * that the matching `query-input` declares, per schema.org's sitelinks
 * search-box spec.
 */

export interface WebSiteArgs {
  url: string
  /** Search URL template containing the `{search_term_string}` placeholder. */
  searchUrlTemplate: string
}

interface SearchActionBlock {
  '@type': 'SearchAction'
  target: string
  'query-input': 'required name=search_term_string'
}

export interface WebSiteJsonLd {
  '@context': 'https://schema.org'
  '@type': 'WebSite'
  name: 'Outvers'
  url: string
  potentialAction: SearchActionBlock
}

export function website(args: WebSiteArgs): WebSiteJsonLd {
  if (!args.url.trim()) throw new Error('website url must be non-empty')
  if (!args.searchUrlTemplate.includes('{search_term_string}')) {
    throw new Error(
      'website searchUrlTemplate must contain the {search_term_string} placeholder',
    )
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Outvers',
    url: args.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: args.searchUrlTemplate,
      'query-input': 'required name=search_term_string',
    },
  }
}
