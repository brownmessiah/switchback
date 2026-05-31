/**
 * Sitemap generation utilities for per-locale sitemaps.
 *
 * Per ADR-0012 and ADR-0013:
 * - /sitemap.xml indexes /sitemap-en.xml and /sitemap-hi.xml
 * - Each per-locale sitemap contains all public route URLs
 * - English URLs have no prefix; other locales get /{locale}/ prefix
 * - All URLs are absolute with the correct domain
 * - Uses LAUNCH_LOCALES so future locales are included automatically
 */

import { listActivities } from '@/lib/activities/registry'
import { listCategories } from '@/lib/activities/queries'
import { DEFAULT_LOCALE, LAUNCH_LOCALES } from '@/lib/i18n/config'

/** Static public paths that appear in every locale's sitemap. */
export const STATIC_PUBLIC_PATHS: readonly string[] = [
  '/',
  '/search',
  '/sign-in',
  '/cancellation-policy',
] as const

/** Returns the site's base URL from env, without trailing slash. */
export function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://outvers.in'
  return raw.replace(/\/$/, '')
}

export interface SitemapEntry {
  readonly url: string
  readonly lastModified: Date
  readonly changeFrequency:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never'
  readonly priority: number
}

/**
 * Build an absolute URL for a sitemap entry.
 */
function absoluteUrl(pathname: string, locale: string): string {
  const base = getSiteUrl()
  if (locale === DEFAULT_LOCALE) {
    // English: no prefix
    if (pathname === '/') return `${base}/`
    return `${base}${pathname}`
  }
  // Non-default locale: add /{locale}/ prefix
  if (pathname === '/') return `${base}/${locale}/`
  return `${base}/${locale}${pathname}`
}

/** Priority map for different route types. */
const PRIORITY_MAP: Record<string, number> = {
  '/': 1.0,
  '/search': 0.8,
  '/sign-in': 0.3,
  '/cancellation-policy': 0.5,
}

/** Change frequency map for different route types. */
const FREQUENCY_MAP: Record<string, SitemapEntry['changeFrequency']> = {
  '/': 'daily',
  '/search': 'daily',
  '/sign-in': 'monthly',
  '/cancellation-policy': 'monthly',
}

/**
 * Generate sitemap entries for all static public routes in a given locale.
 *
 * Dynamic routes (adventure/[slug], experience/[slug], vendor/[slug]) are
 * not included here — they require DB queries and are added by the sitemap
 * route handler at build/request time.
 *
 * @param locale - The locale code (e.g. 'en', 'hi', 'ta')
 * @returns Array of sitemap entries with absolute URLs
 */
export function generateSitemapUrls(locale: string): readonly SitemapEntry[] {
  const now = new Date()

  return STATIC_PUBLIC_PATHS.map((path) => ({
    url: absoluteUrl(path, locale),
    lastModified: now,
    changeFrequency: FREQUENCY_MAP[path] ?? ('weekly' as const),
    priority: PRIORITY_MAP[path] ?? 0.5,
  }))
}

/**
 * Generate sitemap entries for the cross-region activity landing pages
 * (`/activities/{slug}`), one per registry activity, for the given locale.
 *
 * These complement the activity-in-city collection (`/adventure/{slug}`):
 * a self-canonical activity-across-all-regions page. Slugs come straight
 * from the activity registry — no parallel list — so adding an activity
 * surfaces it here automatically. No DB needed: every registered activity
 * gets a crawlable landing URL even before it has published Experiences.
 */
export function generateActivityLandingUrls(
  locale: string,
): readonly SitemapEntry[] {
  const now = new Date()
  return listActivities().map((activity) => ({
    url: absoluteUrl(`/activities/${activity.slug}`, locale),
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }))
}

/**
 * Generate sitemap entries for the category rollup pages
 * (`/category/{slug}`), one per non-empty category, for the given locale.
 *
 * Categories are derived from the activity registry (only those with ≥1
 * activity — the empty `urban` category is excluded), so the set stays in
 * lock-step with the registry. No DB needed.
 */
export function generateCategoryLandingUrls(
  locale: string,
): readonly SitemapEntry[] {
  const now = new Date()
  return listCategories().map((category) => ({
    url: absoluteUrl(`/category/${category}`, locale),
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }))
}

/** Get all published locale codes. Exported for sitemap index generation. */
export function getPublishedLocales(): readonly string[] {
  return [...LAUNCH_LOCALES]
}
