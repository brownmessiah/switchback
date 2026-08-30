import { inArray } from 'drizzle-orm'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/blog/queries'

import { loadBlogContent } from './load'

const DAY_MS = 86_400_000

/**
 * Stub posts from the pre-corpus demo seed. They were insert-only (never
 * truncated), so they linger in any database seeded before this corpus existed.
 * Deleting these exact slugs cleans dev/E2E databases and is a harmless no-op on
 * a fresh production database where they never existed.
 */
const LEGACY_PLACEHOLDER_SLUGS = [
  'rishikesh-rafting-grades-explained',
  'best-time-bir-billing-paragliding',
  'first-scuba-dive-india-checklist',
  'packing-for-a-himalayan-trek',
  'how-outvers-verifies-vendors',
  'monsoon-adventures-in-the-sahyadris',
  'understanding-free-cancellation',
  'leh-ladakh-acclimatisation-guide',
  'snow-leopard-spotting-spiti',
  'beginner-skiing-solang-vs-auli',
]

/** Minimum body length the seeder will accept (never ship empty/stub posts). */
const MIN_BODY_CHARS = 800

/**
 * Dedicated editorial author used by the standalone (production) seed path so
 * the corpus does not depend on the ephemeral demo admin. Display name is the
 * public blog byline (`blog_posts.author_admin_id → users.name`).
 */
export const EDITORIAL_AUTHOR = {
  id: 'u_content_editor',
  email: 'editorial@outvers.com',
  name: 'Switchback Editorial Team',
} as const

export interface UpsertBlogPostsOptions {
  /** Use an existing admin id as the byline (demo path). Self-provisions if omitted. */
  authorAdminId?: string
  /** Baseline date the staggered publish dates are measured back from. */
  now?: Date
}

/**
 * Idempotently upsert the editorial corpus (`db/content/blog`) into `blog_posts`,
 * keyed on `slug`. Safe to run repeatedly and independently of the demo seed:
 * re-running refreshes content/excerpt/cover/date in place. Refuses to seed if
 * any post is missing prose, so a half-authored corpus can never ship.
 */
export async function upsertBlogPosts(
  db: DBOrTx,
  opts: UpsertBlogPostsOptions = {},
): Promise<{ count: number }> {
  const now = opts.now ?? new Date()
  const entries = loadBlogContent()

  for (const e of entries) {
    if (e.content.length < MIN_BODY_CHARS) {
      throw new Error(`blog corpus: body for "${e.slug}" is missing or too short`)
    }
    if (!e.excerpt) {
      throw new Error(`blog corpus: excerpt for "${e.slug}" is missing`)
    }
  }

  let authorAdminId = opts.authorAdminId
  if (!authorAdminId) {
    await db.insert(users).values({ ...EDITORIAL_AUTHOR }).onConflictDoNothing()
    await db
      .insert(adminProfiles)
      .values({ userId: EDITORIAL_AUTHOR.id, permissions: ['blog'] })
      .onConflictDoNothing()
    authorAdminId = EDITORIAL_AUTHOR.id
  }

  await db.delete(blogPosts).where(inArray(blogPosts.slug, LEGACY_PLACEHOLDER_SLUGS))

  for (const e of entries) {
    const publishedAt = new Date(now.getTime() - e.publishedOffsetDays * DAY_MS)
    await db
      .insert(blogPosts)
      .values({
        title: e.title,
        slug: e.slug,
        content: e.content,
        excerpt: e.excerpt,
        category: e.category,
        coverImageUrl: e.coverImageUrl,
        status: 'published',
        publishedAt,
        authorAdminId,
      })
      .onConflictDoUpdate({
        target: blogPosts.slug,
        set: {
          title: e.title,
          content: e.content,
          excerpt: e.excerpt,
          category: e.category,
          coverImageUrl: e.coverImageUrl,
          status: 'published',
          publishedAt,
          updatedAt: now,
        },
      })
  }

  return { count: entries.length }
}
