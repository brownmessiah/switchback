import { describe, expect, it } from 'vitest'

import { BLOG_CATEGORIES } from '@/db/schema/blog-posts'
import { loadBlogContent } from '@/db/content/blog/load'
import { isActivitySlug } from '@/lib/activities/registry'
import { parseActivityCitySlug } from '@/lib/collections/activity-city-loader'
import { isRegionSlug } from '@/lib/regions/registry'

/**
 * Content-integrity guardrail for the editorial blog corpus (the ~40 seeded
 * posts authored in db/content/blog). This is the TDD anchor: it encodes every
 * SEO + quality + renderer-safety invariant the corpus must hold, so a bad post
 * fails CI instead of shipping. It does NOT judge prose quality — only the
 * machine-checkable structure.
 */

const entries = loadBlogContent()

/** Expected category distribution (intent-weighted, locked with owner). */
const EXPECTED_DISTRIBUTION: Record<string, number> = {
  guides: 10,
  destinations: 9,
  adventure: 9,
  tips: 8,
  culture: 4,
}

/**
 * Validate that an in-content internal link points at a route that actually
 * resolves, using the real controlled-vocabulary registries (no dead links).
 */
function internalLinkResolves(href: string): boolean {
  if (href === '/destinations' || href === '/safety') return true
  const region = href.match(/^\/destinations\/([a-z0-9-]+)$/)
  if (region) return isRegionSlug(region[1])
  const activity = href.match(/^\/activities\/([a-z0-9-]+)$/)
  if (activity) return isActivitySlug(activity[1])
  const adventure = href.match(/^\/adventure\/([a-z0-9-]+)$/)
  if (adventure) return parseActivityCitySlug(adventure[1]) !== null
  return false
}

describe('blog content corpus', () => {
  it('contains exactly 40 posts', () => {
    expect(entries).toHaveLength(40)
  })

  it('matches the locked category distribution', () => {
    const counts: Record<string, number> = {}
    for (const e of entries) counts[e.category] = (counts[e.category] ?? 0) + 1
    expect(counts).toEqual(EXPECTED_DISTRIBUTION)
  })

  it('uses only valid blog categories', () => {
    for (const e of entries) {
      expect(BLOG_CATEGORIES).toContain(e.category)
    }
  })

  it('has unique, SEO-clean slugs', () => {
    const slugs = entries.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(slug.length).toBeLessThanOrEqual(70)
    }
  })

  it('has SEO-sane titles', () => {
    for (const e of entries) {
      expect(e.title.trim()).toBe(e.title)
      expect(e.title.length).toBeGreaterThanOrEqual(15)
      expect(e.title.length).toBeLessThanOrEqual(75)
    }
  })

  it('has meta-description-ready excerpts', () => {
    for (const e of entries) {
      expect(e.excerpt.length).toBeGreaterThanOrEqual(50)
      expect(e.excerpt.length).toBeLessThanOrEqual(160)
      expect(e.excerpt).not.toContain('\n')
    }
  })

  it('has substantial, structured Markdown bodies', () => {
    for (const e of entries) {
      // ~800-word floor proxy; real posts are far longer.
      expect(e.content.length).toBeGreaterThanOrEqual(2500)
      // At least 3 section headings for scannability.
      const h2Count = (e.content.match(/^## /gm) ?? []).length
      expect(h2Count, `${e.slug} needs >=3 H2 sections`).toBeGreaterThanOrEqual(3)
      // No duplicate H1 (page renders the title separately).
      expect(e.content.trimStart().startsWith('# ')).toBe(false)
    }
  })

  it('uses only renderer-safe Markdown (no tables, images, blockquotes, raw HTML)', () => {
    for (const e of entries) {
      expect(e.content, `${e.slug} has a Markdown table`).not.toMatch(/^\|.*\|/m)
      expect(e.content, `${e.slug} has an inline image`).not.toMatch(/!\[[^\]]*\]\(/)
      expect(e.content, `${e.slug} has a blockquote`).not.toMatch(/^> /m)
      expect(e.content, `${e.slug} has raw HTML`).not.toMatch(/<[a-z][\s\S]*>/i)
    }
  })

  it('places >=2 resolvable internal links inside the body', () => {
    for (const e of entries) {
      expect(e.internalLinks.length, `${e.slug} needs >=2 internal links`).toBeGreaterThanOrEqual(2)
      for (const href of e.internalLinks) {
        expect(internalLinkResolves(href), `${e.slug}: dead internal link ${href}`).toBe(true)
        // The declared link must actually appear in the rendered body.
        expect(e.content.includes(`(${href})`), `${e.slug}: ${href} not in body`).toBe(true)
      }
    }
  })

  it('has a valid cover image (Unsplash CDN or same-origin local)', () => {
    for (const e of entries) {
      const ok =
        e.coverImageUrl.startsWith('https://images.unsplash.com/') ||
        e.coverImageUrl === `/images/blog/${e.slug}.jpg`
      expect(ok, `${e.slug}: bad cover ${e.coverImageUrl}`).toBe(true)
    }
  })

  it('staggers publish dates (distinct offsets within the last year)', () => {
    const offsets = entries.map((e) => e.publishedOffsetDays)
    expect(new Set(offsets).size).toBe(offsets.length)
    for (const o of offsets) {
      expect(o).toBeGreaterThanOrEqual(1)
      expect(o).toBeLessThanOrEqual(365)
    }
  })
})
