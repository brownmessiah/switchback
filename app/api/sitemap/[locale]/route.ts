/**
 * Per-locale sitemap handler — serves `/sitemap-{locale}.xml`
 *
 * Rewritten from `/sitemap-{locale}.xml` via next.config.ts rewrites.
 *
 * Per ADR-0012 and ADR-0013:
 * - /sitemap-en.xml contains all public route URLs without locale prefix
 * - /sitemap-hi.xml contains all public route URLs with /hi/ prefix
 * - All URLs are absolute with the correct domain
 */

import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import {
  generateAdventureSitemapUrls,
  generateExperienceSitemapUrls,
  generateSitemapUrls,
  generateVendorSitemapUrls,
  type SitemapEntry,
} from '@/lib/seo/sitemap'

export async function GET(
  _request: Request,
  props: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await props.params

  // The per-locale sitemap is the UNION of the static public paths and the
  // DB-driven dynamic route families. On this branch only the
  // experience / adventure / vendor families exist; the blog / destinations
  // / activities / category families are added by their own branches
  // (#03–#05) and will union in here once merged.
  const [experienceEntries, adventureEntries, vendorEntries] =
    await Promise.all([
      generateExperienceSitemapUrls(db, locale),
      generateAdventureSitemapUrls(db, locale),
      generateVendorSitemapUrls(db, locale),
    ])

  const entries: readonly SitemapEntry[] = [
    ...generateSitemapUrls(locale),
    ...experienceEntries,
    ...adventureEntries,
    ...vendorEntries,
  ]

  const urls = entries
    .map(
      (entry) =>
        `  <url>
    <loc>${entry.url}</loc>
    <lastmod>${entry.lastModified.toISOString()}</lastmod>
    <changefreq>${entry.changeFrequency}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    )
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
