import { and, desc, eq, sql } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'
import type * as schema from '@/db/schema'

export type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export interface BlogPostListItem {
  slug: string
  title: string
  excerpt: string | null
  category: string
  coverImageUrl: string | null
  publishedAt: Date | null
}

export interface BlogPostDetail extends BlogPostListItem {
  content: string
  authorName: string | null
  updatedAt: Date | null
}

export interface BlogPostPage {
  posts: BlogPostListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ListPublishedBlogPostsArgs {
  page?: number
  pageSize?: number
}

const DEFAULT_PAGE_SIZE = 9

/**
 * List published blog posts, newest first, paginated. Drafts are never
 * returned (only `status='published'`).
 */
export async function listPublishedBlogPosts(
  db: DBOrTx,
  args: ListPublishedBlogPostsArgs = {},
): Promise<BlogPostPage> {
  const page = Math.max(1, args.page ?? 1)
  const pageSize = Math.max(1, args.pageSize ?? DEFAULT_PAGE_SIZE)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
  const total = Number(count)

  const rows = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      category: blogPosts.category,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    posts: rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

/**
 * Load a single published blog post by slug (with author display name), or
 * null when the slug is missing or the post is not published.
 */
export async function getPublishedBlogPostBySlug(
  db: DBOrTx,
  slug: string,
): Promise<BlogPostDetail | null> {
  const [row] = await db
    .select({
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      category: blogPosts.category,
      coverImageUrl: blogPosts.coverImageUrl,
      publishedAt: blogPosts.publishedAt,
      content: blogPosts.content,
      updatedAt: blogPosts.updatedAt,
      authorName: users.name,
    })
    .from(blogPosts)
    .leftJoin(users, eq(blogPosts.authorAdminId, users.id))
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'published')))
    .limit(1)

  if (!row) return null
  return { ...row, authorName: row.authorName ?? null }
}

export interface BlogSitemapRow {
  slug: string
  lastModified: Date
}

/**
 * All published blog post slugs + their last-modified date, for the sitemap.
 */
export async function listPublishedBlogPostsForSitemap(
  db: DBOrTx,
): Promise<BlogSitemapRow[]> {
  const rows = await db
    .select({
      slug: blogPosts.slug,
      updatedAt: blogPosts.updatedAt,
      publishedAt: blogPosts.publishedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, 'published'))
    .orderBy(desc(blogPosts.publishedAt))

  return rows.map((r) => ({ slug: r.slug, lastModified: r.updatedAt ?? r.publishedAt ?? new Date() }))
}
