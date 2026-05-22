/**
 * BreadcrumbList JSON-LD generator per ADR-0013.
 *
 * Composed into every public collection / detail / blog page so search
 * engines can render the breadcrumb trail in SERP results and
 * understand the site hierarchy. Position is 1-indexed per
 * schema.org's BreadcrumbList spec.
 */

export interface BreadcrumbCrumb {
  name: string
  url: string
}

export interface BreadcrumbListJsonLd {
  '@context': 'https://schema.org'
  '@type': 'BreadcrumbList'
  itemListElement: Array<{
    '@type': 'ListItem'
    position: number
    name: string
    item: string
  }>
}

export function breadcrumbList(crumbs: BreadcrumbCrumb[]): BreadcrumbListJsonLd {
  if (crumbs.length === 0) {
    throw new Error('breadcrumbList requires at least one crumb')
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  }
}
