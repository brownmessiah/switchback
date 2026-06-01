/**
 * hreflang alternate link generation for public pages.
 *
 * Per ADR-0012 and ADR-0013:
 * - Every translated page includes hreflang alternate links for all published locales
 * - x-default points to the English (un-prefixed) URL
 * - Canonical URL is the localised URL (each locale ranks independently)
 * - Uses LAUNCH_LOCALES so future locales are included automatically
 */

import { DEFAULT_LOCALE, LAUNCH_LOCALES } from '@/lib/i18n/config'

/**
 * Static public route pathnames (without locale prefix).
 * Dynamic routes (adventure/[slug], experience/[slug], vendor/[slug])
 * are included as patterns — pages with slugs call generateAlternates
 * with the resolved pathname at render time.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/search',
  '/destinations',
  '/sign-in',
  '/cancellation-policy',
  '/safety',
  '/about',
  '/help',
  '/contact',
  '/trip-planner',
  '/adventure/[slug]',
  '/destinations/[slug]',
  '/activities/[slug]',
  '/category/[slug]',
  '/experience/[slug]',
  '/vendor/[slug]',
] as const

/** Returns the site's base URL from env, without trailing slash. */
function getSiteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    'https://outvers.in'
  return raw.replace(/\/$/, '')
}

/**
 * Build an absolute URL from a pathname.
 * The pathname should start with `/` for non-root paths.
 */
export function getAbsoluteUrl(pathname: string): string {
  const base = getSiteUrl()
  if (pathname === '' || pathname === '/') {
    return `${base}/`
  }
  // Ensure single slash join
  const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  return `${base}${cleanPath}`
}

/**
 * Build the localised pathname for a given route pathname and locale.
 * English (default locale) uses no prefix; other locales get `/{locale}/...`
 */
function localizedPathname(pathname: string, locale: string): string {
  if (locale === DEFAULT_LOCALE) {
    return pathname
  }
  if (pathname === '/') {
    return `/${locale}/`
  }
  return `/${locale}${pathname}`
}

export interface AlternatesResult {
  readonly canonical: string
  readonly languages: Record<string, string>
}

/**
 * Generate the `alternates` object for Next.js Metadata API.
 *
 * @param pathname - The route pathname without locale prefix (e.g. `/search`, `/adventure/rafting-in-rishikesh`)
 * @param currentLocale - The current page's locale code (e.g. `'en'`, `'hi'`)
 * @returns Object compatible with Next.js `Metadata.alternates`
 */
export function generateAlternates(
  pathname: string,
  currentLocale: string,
): AlternatesResult {
  const canonical = getAbsoluteUrl(localizedPathname(pathname, currentLocale))

  const languages: Record<string, string> = {}

  for (const locale of LAUNCH_LOCALES) {
    languages[locale] = getAbsoluteUrl(localizedPathname(pathname, locale))
  }

  // x-default always points to English (un-prefixed)
  languages['x-default'] = getAbsoluteUrl(
    localizedPathname(pathname, DEFAULT_LOCALE),
  )

  return { canonical, languages }
}
