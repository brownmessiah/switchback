import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { getActivityImage, getRegionImage } from '@/lib/images'

import { BLOG_CONTENT_META } from './entries'
import type { BlogContentEntry, BlogCover } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
const POSTS_DIR = join(HERE, 'posts')
const EXCERPTS_PATH = join(HERE, 'excerpts.json')

/** Resolve a cover descriptor to a concrete image URL. */
function resolveCover(cover: BlogCover, slug: string): string {
  switch (cover.kind) {
    case 'activity':
      return getActivityImage(cover.slug, cover.variant ?? 0)
    case 'region':
      return getRegionImage(cover.slug)
    case 'local':
      return `/images/blog/${slug}.jpg`
  }
}

/** Read a post's Markdown body, or '' if it has not been authored yet. */
function readBody(slug: string): string {
  const path = join(POSTS_DIR, `${slug}.md`)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
}

/** Read the slug → meta-description map, or {} if absent. */
function readExcerpts(): Record<string, string> {
  if (!existsSync(EXCERPTS_PATH)) return {}
  return JSON.parse(readFileSync(EXCERPTS_PATH, 'utf8')) as Record<string, string>
}

/**
 * Load the full editorial corpus: structural metadata (`entries.ts`) merged with
 * authored prose (`posts/<slug>.md`) and meta descriptions (`excerpts.json`),
 * with cover URLs resolved against the curated image pools. Used by both the
 * integrity test and the seeder. Filesystem-only — never imported by app routes.
 */
export function loadBlogContent(): BlogContentEntry[] {
  const excerpts = readExcerpts()
  return BLOG_CONTENT_META.map((meta) => ({
    slug: meta.slug,
    title: meta.title,
    category: meta.category,
    excerpt: excerpts[meta.slug] ?? '',
    content: readBody(meta.slug),
    coverImageUrl: resolveCover(meta.cover, meta.slug),
    internalLinks: meta.internalLinks,
    publishedOffsetDays: meta.publishedOffsetDays,
  }))
}
