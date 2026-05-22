/**
 * Region registry per ADR-0013.
 *
 * Controlled vocabulary of (region_slug, display_name_per_locale, state)
 * triples. Region slugs are NOT vendor-chosen — they form the canonical
 * URL component of `/{lng}/adventure/{activity}-in-{region}` collection
 * pages and feed into BreadcrumbList / ItemList JSON-LD generation.
 *
 * Adding a region is a code change in v1. The bar for adding one is
 * that we have at least three published Experiences whose
 * `region_slug` references it; otherwise the collection page is empty
 * and hurts SEO.
 *
 * Display names are per launch locale (en + hi). Other locales added
 * as content fills out per ADR-0012.
 */

export interface RegionDisplay {
  en: string
  hi: string
}

export interface RegionMeta {
  slug: string
  displayName: RegionDisplay
  /** Indian state — used in breadcrumbs and the BreadcrumbList JSON-LD. */
  state: string
}

const REGIONS: readonly RegionMeta[] = [
  {
    slug: 'rishikesh',
    displayName: { en: 'Rishikesh', hi: 'ऋषिकेश' },
    state: 'Uttarakhand',
  },
  {
    slug: 'manali',
    displayName: { en: 'Manali', hi: 'मनाली' },
    state: 'Himachal Pradesh',
  },
  {
    slug: 'bir-billing',
    displayName: { en: 'Bir Billing', hi: 'बीर बिलिंग' },
    state: 'Himachal Pradesh',
  },
  {
    slug: 'goa',
    displayName: { en: 'Goa', hi: 'गोवा' },
    state: 'Goa',
  },
  {
    slug: 'leh-ladakh',
    displayName: { en: 'Leh-Ladakh', hi: 'लेह-लद्दाख' },
    state: 'Ladakh',
  },
  {
    slug: 'kasol',
    displayName: { en: 'Kasol', hi: 'कसोल' },
    state: 'Himachal Pradesh',
  },
  {
    slug: 'spiti',
    displayName: { en: 'Spiti Valley', hi: 'स्पीति घाटी' },
    state: 'Himachal Pradesh',
  },
  {
    slug: 'andaman',
    displayName: { en: 'Andaman Islands', hi: 'अंडमान द्वीप' },
    state: 'Andaman and Nicobar Islands',
  },
  {
    slug: 'lonavala',
    displayName: { en: 'Lonavala', hi: 'लोनावला' },
    state: 'Maharashtra',
  },
  {
    slug: 'auli',
    displayName: { en: 'Auli', hi: 'औली' },
    state: 'Uttarakhand',
  },
]

const REGIONS_BY_SLUG = new Map(REGIONS.map((r) => [r.slug, r]))

export function listRegions(): readonly RegionMeta[] {
  return REGIONS
}

export function getRegion(slug: string): RegionMeta | undefined {
  return REGIONS_BY_SLUG.get(slug)
}

export function isRegionSlug(value: unknown): value is string {
  return typeof value === 'string' && REGIONS_BY_SLUG.has(value)
}
