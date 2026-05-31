/**
 * robots.txt generator — `/robots.txt`
 *
 * Allows all crawlers to reach the public surface and disallows the
 * authed / non-public surfaces (admin console, customer dashboard,
 * checkout, bookings, the authed vendor portal, and internal APIs).
 *
 * IMPORTANT: `/vendor/{slug}` storefronts are PUBLIC, so we must NOT
 * disallow the bare `/vendor/` prefix — only the specific authed vendor
 * portal sub-paths (`/vendor/dashboard`, `/vendor/listings`, etc.).
 *
 * The sitemap points at `/sitemap.xml` (the per-locale sitemap index).
 */

import type { MetadataRoute } from 'next'

import { getSiteUrl } from '@/lib/seo/sitemap'

/**
 * Non-public path prefixes. Crawlers honour prefix matches, so
 * `/admin/` covers `/admin/dashboard`, `/admin/payouts`, etc.
 *
 * Customer-authed: /dashboard, /checkout, /bookings.
 * Vendor-authed portal (NOT the public /vendor/{slug} storefront):
 *   /vendor/dashboard, /vendor/listings, /vendor/bookings,
 *   /vendor/payouts, /vendor/messages, /vendor/settings,
 *   /vendor/reviews, /vendor/onboarding.
 * Plus forward-safe entries for surfaces that may land later
 * (/wallet, /wishlist, /settings, /support) and all internal APIs.
 */
const DISALLOWED_PATHS: readonly string[] = [
  '/admin/',
  '/dashboard',
  '/checkout',
  '/bookings',
  '/vendor/dashboard',
  '/vendor/listings',
  '/vendor/bookings',
  '/vendor/payouts',
  '/vendor/messages',
  '/vendor/settings',
  '/vendor/reviews',
  '/vendor/onboarding',
  '/wallet',
  '/wishlist',
  '/settings',
  '/support',
  '/api/',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [...DISALLOWED_PATHS],
    },
    sitemap: `${getSiteUrl()}/sitemap.xml`,
  }
}
