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
import { listCategories } from '@/lib/activities/queries'
import { isActivitySlug, listActivities } from '@/lib/activities/registry'
import { DEFAULT_LOCALE, LAUNCH_LOCALES } from '@/lib/i18n/config'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { isRegionSlug, listRegions } from '@/lib/regions/registry'

/** Static public paths that appear in every locale's sitemap. */
export const STATIC_PUBLIC_PATHS: readonly string[] = [
  '/',
  '/search',
  '/destinations',
  '/sign-in',
  '/cancellation-policy',
  '/blog',
  '/help',
  '/contact',
  '/trip-planner',
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
  '/destinations': 0.8,
  '/sign-in': 0.3,
  '/cancellation-policy': 0.5,
  '/blog': 0.6,
  '/help': 0.5,
  '/contact': 0.4,
  '/trip-planner': 0.7,
}

/** Change frequency map for different route types. */
const FREQUENCY_MAP: Record<string, SitemapEntry['changeFrequency']> = {
  '/': 'daily',
  '/search': 'daily',
  '/destinations': 'weekly',
  '/sign-in': 'monthly',
  '/cancellation-policy': 'monthly',
  '/blog': 'daily',
  '/help': 'monthly',
  '/contact': 'yearly',
  '/trip-planner': 'weekly',
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

/**
 * Generate sitemap entries for every region landing
 * (`/destinations/{slug}`) in a given locale.
 *
 * The region list is static (sourced from the region registry), so no DB
 * query is needed — unlike experience/vendor URLs, these are emitted
 * directly from the controlled vocabulary.
 *
 * @param locale - The locale code (e.g. 'en', 'hi', 'ta')
 * @returns Array of sitemap entries with absolute URLs
 */
export function generateDestinationSitemapUrls(
  locale: string,
): readonly SitemapEntry[] {
  const now = new Date()

  return listRegions().map((region) => ({
    url: absoluteUrl(`/destinations/${region.slug}`, locale),
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
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
