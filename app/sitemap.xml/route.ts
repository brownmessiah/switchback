/**
 * Root sitemap index — `/sitemap.xml`
 *
 * Returns a sitemap index that points to per-locale sitemaps:
 *   /sitemap-en.xml, /sitemap-hi.xml, etc.
 *
 * Per ADR-0012: per-locale sitemap files indexed from /sitemap.xml.
 * Uses LAUNCH_LOCALES so new locales are included automatically.
 */

import { NextResponse } from 'next/server'

import { getPublishedLocales, getSiteUrl } from '@/lib/seo/sitemap'

export const dynamic = 'force-static'

export function GET(): NextResponse {
  const siteUrl = getSiteUrl()
  const locales = getPublishedLocales()

  const sitemaps = locales
    .map(
      (locale) =>
        `  <sitemap>
    <loc>${siteUrl}/sitemap-${locale}.xml</loc>
  </sitemap>`,
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
