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
import { listPublishedBlogPostsForSitemap } from '@/lib/blog/queries'
import {
  buildSitemapEntry,
  generateActivityLandingUrls,
  generateAdventureSitemapUrls,
  generateCategoryLandingUrls,
  generateDestinationSitemapUrls,
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

  // The per-locale sitemap is the UNION of the static public paths, the
  // registry-driven landings (destinations / activities / categories), and the
  // DB-driven dynamic families (published blog posts, experiences, adventure
  // collections, vendor storefronts).
  const [blogPosts, experienceEntries, adventureEntries, vendorEntries] =
    await Promise.all([
      listPublishedBlogPostsForSitemap(db),
      generateExperienceSitemapUrls(db, locale),
      generateAdventureSitemapUrls(db, locale),
      generateVendorSitemapUrls(db, locale),
    ])
  const blogEntries: SitemapEntry[] = blogPosts.map((p) =>
    buildSitemapEntry(`/blog/${p.slug}`, locale, p.lastModified, 'weekly', 0.5),
  )

  const entries: readonly SitemapEntry[] = [
    ...generateSitemapUrls(locale),
    ...generateDestinationSitemapUrls(locale),
    ...generateActivityLandingUrls(locale),
    ...generateCategoryLandingUrls(locale),
    ...blogEntries,
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
