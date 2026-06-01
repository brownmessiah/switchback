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
  generateCategoryLandingUrls,
  generateDestinationSitemapUrls,
  generateSitemapUrls,
  type SitemapEntry,
} from '@/lib/seo/sitemap'

export async function GET(
  _request: Request,
  props: { params: Promise<{ locale: string }> },
): Promise<NextResponse> {
  const { locale } = await props.params

  // Static public paths + region landings (/destinations/{slug}) +
  // cross-region activity landings (/activities/{slug}) + category rollups
  // (/category/{slug}) + dynamic (DB-sourced) published blog posts.
  // Remaining dynamic families (experiences) land in #13.
  const blogPosts = await listPublishedBlogPostsForSitemap(db)
  const blogEntries: SitemapEntry[] = blogPosts.map((p) =>
    buildSitemapEntry(`/blog/${p.slug}`, locale, p.lastModified, 'weekly', 0.5),
  )
  const entries = [
    ...generateSitemapUrls(locale),
    ...generateDestinationSitemapUrls(locale),
    ...generateActivityLandingUrls(locale),
    ...generateCategoryLandingUrls(locale),
    ...blogEntries,
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
