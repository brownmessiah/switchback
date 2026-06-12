import type { BlogCategory } from '@/db/schema/blog-posts'

/**
 * How a post's cover image is sourced. Place/activity covers reuse the curated,
 * visually-verified Unsplash pools in `lib/images.ts` (real photos). `local`
 * covers are AI-generated concept headers committed under
 * `public/images/blog/<slug>.webp` and served same-origin.
 */
export type BlogCover =
  | { kind: 'activity'; slug: string; variant?: number }
  | { kind: 'region'; slug: string }
  | { kind: 'local' }

/**
 * Structural metadata for one editorial post. The prose (`content`) and meta
 * description (`excerpt`) live alongside in `posts/<slug>.md` + `excerpts.json`
 * and are merged in by `loadBlogContent()`. This split keeps the plan diffable
 * and each Markdown body a small, reviewable file.
 */
export interface BlogContentMeta {
  slug: string
  title: string
  category: BlogCategory
  /** Primary search intent the post targets (provenance/documentation). */
  targetKeyword: string
  cover: BlogCover
  /** Internal links (durable registry-backed routes) that must appear in body. */
  internalLinks: string[]
  /** Days before the seed baseline this post is dated; distinct across corpus. */
  publishedOffsetDays: number
  /** Author word-count target handed to the writing subagent. */
  wordTarget: number
}

/** A fully-resolved post: metadata + merged prose + resolved cover URL. */
export interface BlogContentEntry {
  slug: string
  title: string
  category: BlogCategory
  excerpt: string
  content: string
  coverImageUrl: string
  internalLinks: string[]
  publishedOffsetDays: number
}
