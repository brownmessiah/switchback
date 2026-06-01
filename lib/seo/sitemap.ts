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

import { DEFAULT_LOCALE, LAUNCH_LOCALES } from '@/lib/i18n/config'

/** Static public paths that appear in every locale's sitemap. */
export const STATIC_PUBLIC_PATHS: readonly string[] = [
  '/',
  '/search',
  '/sign-in',
  '/cancellation-policy',
  '/blog',
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
  '/blog': 0.6,
}

/** Change frequency map for different route types. */
const FREQUENCY_MAP: Record<string, SitemapEntry['changeFrequency']> = {
  '/': 'daily',
  '/search': 'daily',
  '/sign-in': 'monthly',
  '/cancellation-policy': 'monthly',
  '/blog': 'daily',
}

/**
 * Build a single sitemap entry for a dynamic (DB-sourced) route, in the given
 * locale. Reusable by the per-locale sitemap route handler for blog posts,
 * experiences, destinations, etc. (the dynamic families added in #03–#05/#13).
 */
export function buildSitemapEntry(
  pathname: string,
  locale: string,
  lastModified: Date,
  changeFrequency: SitemapEntry['changeFrequency'] = 'weekly',
  priority = 0.6,
): SitemapEntry {
  return { url: absoluteUrl(pathname, locale), lastModified, changeFrequency, priority }
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

/** Get all published locale codes. Exported for sitemap index generation. */
export function getPublishedLocales(): readonly string[] {
  return [...LAUNCH_LOCALES]
}
