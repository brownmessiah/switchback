import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Blog posts managed by admins via the Blog CMS (admin permission: 'blog').
 *
 * Content is stored as raw Markdown in the `content` column; rendering
 * happens at read-time via a Markdown library. `status` gates public
 * visibility: only 'published' posts with a non-null `publishedAt` are
 * shown on the marketing site.
 *
 * `slug` is unique and auto-generated from `title` at creation time,
 * but may be overridden. A unique index enforces the constraint at the
 * database level.
 */

export const BLOG_CATEGORIES = [
  'guides',
  'tips',
  'destinations',
  'culture',
  'adventure',
] as const

export type BlogCategory = (typeof BLOG_CATEGORIES)[number]

export const BLOG_STATUSES = ['draft', 'published'] as const
export type BlogStatus = (typeof BLOG_STATUSES)[number]

export const blogPosts = pgTable(
  'blog_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    content: text('content').notNull().default(''),
    excerpt: text('excerpt'),
    category: text('category').notNull(),
    coverImageUrl: text('cover_image_url'),
    status: text('status').notNull().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    authorAdminId: text('author_admin_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('blog_posts_slug_unique').on(table.slug)],
)

export type BlogPost = typeof blogPosts.$inferSelect
export type NewBlogPost = typeof blogPosts.$inferInsert
