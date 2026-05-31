/**
 * Routing configuration for next-intl middleware and navigation.
 *
 * Per ADR-0012 + ADR-0013:
 * - Public marketing routes use path-prefix locale routing
 * - en is un-prefixed (canonical), other locales get /{locale}/ prefix
 * - Admin, vendor, customer, and API routes are excluded from locale routing
 */

import { defineRouting } from 'next-intl/routing'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './config'

export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeCookie: {
    name: 'locale',
    sameSite: 'lax' as const,
  },
})

/**
 * Pathname prefixes that must NOT be rewritten by the i18n middleware.
 * These routes are either authenticated dashboards (no SEO value)
 * or API endpoints.
 */
export const EXCLUDED_PREFIXES = [
  '/admin',
  '/vendor/dashboard',
  '/vendor/listings',
  '/vendor/bookings',
  '/vendor/messages',
  '/vendor/onboarding',
  '/vendor/payouts',
  '/vendor/reviews',
  '/vendor/settings',
  '/dashboard',
  '/support',
  '/checkout',
  '/bookings',
  '/api',
] as const

/**
 * Returns true if the given pathname should bypass i18n locale rewriting.
 * Used by middleware to decide whether to apply next-intl or pass through.
 */
export function shouldExcludeFromI18n(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}
