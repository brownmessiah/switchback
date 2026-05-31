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

import { and, eq } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { isActivitySlug } from '@/lib/activities/registry'
import { DEFAULT_LOCALE, LAUNCH_LOCALES } from '@/lib/i18n/config'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { isRegionSlug } from '@/lib/regions/registry'

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
 * Build a single sitemap entry, applying the locale-prefix rule
 * (en = no prefix, others = `/{locale}/path`) via `absoluteUrl`.
 *
 * Shared by the static-path builder and the DB-driven dynamic
 * generators so all entries go through one URL-construction path.
 */
export function buildSitemapEntry(
  pathname: string,
  locale: string,
  lastModified: Date,
  changeFrequency: SitemapEntry['changeFrequency'] = 'weekly',
  priority = 0.5,
): SitemapEntry {
  return {
    url: absoluteUrl(pathname, locale),
    lastModified,
    changeFrequency,
    priority,
  }
}

/**
 * Generate sitemap entries for all static public routes in a given locale.
 *
 * Dynamic routes (adventure/[slug], experience/[slug], vendor/[slug]) are
 * generated separately by the DB-driven helpers below and unioned in by
 * the per-locale sitemap route handler at request time.
 *
 * @param locale - The locale code (e.g. 'en', 'hi', 'ta')
 * @returns Array of sitemap entries with absolute URLs
 */
export function generateSitemapUrls(locale: string): readonly SitemapEntry[] {
  const now = new Date()

  return STATIC_PUBLIC_PATHS.map((path) =>
    buildSitemapEntry(
      path,
      locale,
      now,
      FREQUENCY_MAP[path] ?? 'weekly',
      PRIORITY_MAP[path] ?? 0.5,
    ),
  )
}

/** Priority / frequency for the dynamic route families. */
const EXPERIENCE_PRIORITY = 0.7
const ADVENTURE_PRIORITY = 0.6
const VENDOR_PRIORITY = 0.5

/**
 * Generate sitemap entries for every published Experience detail page
 * (`/experience/{slug}`) in the given locale.
 *
 * Only `status = 'published'` experiences are emitted; lastModified is
 * the experience's `updatedAt`.
 */
export async function generateExperienceSitemapUrls(
  db: DBOrTx,
  locale: string,
): Promise<SitemapEntry[]> {
  const rows = await db
    .select({ slug: experiences.slug, updatedAt: experiences.updatedAt })
    .from(experiences)
    .where(eq(experiences.status, 'published'))

  return rows.map((row) =>
    buildSitemapEntry(
      `/experience/${row.slug}`,
      locale,
      row.updatedAt,
      'weekly',
      EXPERIENCE_PRIORITY,
    ),
  )
}

/**
 * Generate sitemap entries for every activity-city collection page
 * (`/adventure/{activity}-in-{region}`) that has at least one published
 * Experience AND whose (activitySlug, regionSlug) pair is registry-valid.
 *
 * Empty or off-registry collections are skipped — empty collection pages
 * hurt SEO (per the region/activity registry comments).
 */
export async function generateAdventureSitemapUrls(
  db: DBOrTx,
  locale: string,
): Promise<SitemapEntry[]> {
  const rows = await db
    .selectDistinct({
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
    })
    .from(experiences)
    .where(eq(experiences.status, 'published'))

  const entries: SitemapEntry[] = []
  for (const row of rows) {
    if (!isActivitySlug(row.activitySlug)) continue
    if (!isRegionSlug(row.regionSlug)) continue
    entries.push(
      buildSitemapEntry(
        `/adventure/${row.activitySlug}-in-${row.regionSlug}`,
        locale,
        new Date(),
        'weekly',
        ADVENTURE_PRIORITY,
      ),
    )
  }
  return entries
}

/**
 * Generate sitemap entries for every public vendor storefront
 * (`/vendor/{slug}`) that has at least one published Experience.
 *
 * Vendors with no published catalogue are skipped — their storefront is
 * effectively empty and should not be advertised to crawlers.
 */
export async function generateVendorSitemapUrls(
  db: DBOrTx,
  locale: string,
): Promise<SitemapEntry[]> {
  const rows = await db
    .selectDistinct({ slug: vendorProfiles.slug })
    .from(vendorProfiles)
    .innerJoin(
      experiences,
      and(
        eq(experiences.vendorUserId, vendorProfiles.userId),
        eq(experiences.status, 'published'),
      ),
    )

  return rows.map((row) =>
    buildSitemapEntry(
      `/vendor/${row.slug}`,
      locale,
      new Date(),
      'weekly',
      VENDOR_PRIORITY,
    ),
  )
}

/** Get all published locale codes. Exported for sitemap index generation. */
export function getPublishedLocales(): readonly string[] {
  return [...LAUNCH_LOCALES]
}
