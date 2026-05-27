import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCreateBlogPost,
  executeUpdateBlogPost,
  executeDeleteBlogPost,
  generateUniqueSlug,
} from './actions'
import { generateSlug } from './slug-utils'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_blog_1'
  await db.insert(users).values({ id: adminId, email: 'admin-blog@test.com' })
  return adminId
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Blog post slug generation', () => {
  it('generates a slug from a simple title', () => {
    expect(generateSlug('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(generateSlug("A Guide to Rishikesh's Best Rafting!")).toBe(
      'a-guide-to-rishikeshs-best-rafting',
    )
  })

  it('collapses multiple spaces and hyphens', () => {
    expect(generateSlug('Too   many   spaces')).toBe('too-many-spaces')
    expect(generateSlug('too---many---hyphens')).toBe('too-many-hyphens')
  })

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug(' -hello- ')).toBe('hello')
  })

  it('handles empty string', () => {
    expect(generateSlug('')).toBe('')
  })
})

describe('Admin blog post actions', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, blog_posts, users CASCADE`,
    )
  })

  // ── Create ────────────────────────────────────────────────────────

  describe('executeCreateBlogPost', () => {
    it('creates a draft post with auto-generated slug', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateBlogPost(db, adminId, {
        title: 'Top 10 Rafting Spots in Rishikesh',
        content: '# Introduction\n\nRafting is fun.',
        category: 'adventure',
        status: 'draft',
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.id).toBeDefined()
      }

      const posts = await db.select().from(blogPosts)
      expect(posts).toHaveLength(1)
      expect(posts[0]!.title).toBe('Top 10 Rafting Spots in Rishikesh')
      expect(posts[0]!.slug).toBe('top-10-rafting-spots-in-rishikesh')
      expect(posts[0]!.status).toBe('draft')
      expect(posts[0]!.publishedAt).toBeNull()
      expect(posts[0]!.authorAdminId).toBe(adminId)
    })

    it('sets publishedAt on create when status is published', async () => {
      const adminId = await seedAdmin(db)
      const before = new Date()

      const result = await executeCreateBlogPost(db, adminId, {
        title: 'Published from the start',
        content: 'Live now!',
        category: 'guides',
        status: 'published',
      })

      expect(result.ok).toBe(true)

      const [post] = await db.select().from(blogPosts)
      expect(post!.status).toBe('published')
      expect(post!.publishedAt).not.toBeNull()
      expect(post!.publishedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    })

    it('writes audit log on creation', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'Audit test',
        content: 'content',
        category: 'tips',
        status: 'draft',
      })

      const logs = await db.select().from(auditLogs)
      expect(logs).toHaveLength(1)
      expect(logs[0]!.action).toBe('admin.blog_post.create')
      expect(logs[0]!.actorUserId).toBe(adminId)
      expect(logs[0]!.entityType).toBe('blog_post')
      expect(logs[0]!.payload).toMatchObject({
        title: 'Audit test',
        category: 'tips',
        status: 'draft',
      })
    })

    it('enforces slug uniqueness by appending numeric suffix', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'Same Title',
        content: 'first',
        category: 'guides',
      })

      await executeCreateBlogPost(db, adminId, {
        title: 'Same Title',
        content: 'second',
        category: 'guides',
      })

      const posts = await db.select().from(blogPosts)
      expect(posts).toHaveLength(2)

      const slugs = posts.map((p) => p.slug).sort()
      expect(slugs).toEqual(['same-title', 'same-title-1'])
    })

    it('rejects missing title', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateBlogPost(db, adminId, {
        title: '',
        content: 'no title',
        category: 'guides',
      })

      expect(result.ok).toBe(false)
    })

    it('rejects invalid category', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeCreateBlogPost(db, adminId, {
        title: 'Bad Category',
        content: 'content',
        category: 'invalid' as 'guides',
      })

      expect(result.ok).toBe(false)
    })
  })

  // ── Update ────────────────────────────────────────────────────────

  describe('executeUpdateBlogPost', () => {
    it('updates fields and writes audit log', async () => {
      const adminId = await seedAdmin(db)

      const createResult = await executeCreateBlogPost(db, adminId, {
        title: 'Original Title',
        content: 'original',
        category: 'guides',
      })
      expect(createResult.ok).toBe(true)

      const [post] = await db.select().from(blogPosts)
      const postId = post!.id

      const result = await executeUpdateBlogPost(db, adminId, {
        id: postId,
        title: 'Updated Title',
        content: 'updated content',
        category: 'destinations',
      })

      expect(result.ok).toBe(true)

      const [updated] = await db
        .select()
        .from(blogPosts)
        .where(eq(blogPosts.id, postId))
      expect(updated!.title).toBe('Updated Title')
      expect(updated!.slug).toBe('updated-title')
      expect(updated!.content).toBe('updated content')
      expect(updated!.category).toBe('destinations')

      // Audit log for update
      const logs = await db
        .select()
        .from(auditLogs)
        .orderBy(auditLogs.createdAt)
      const updateLog = logs.find(
        (l) => l.action === 'admin.blog_post.update',
      )
      expect(updateLog).toBeDefined()
      expect(updateLog!.payload).toMatchObject({
        previousTitle: 'Original Title',
      })
    })

    it('sets publishedAt on first publish', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'Draft Post',
        content: 'draft content',
        category: 'tips',
        status: 'draft',
      })

      const [post] = await db.select().from(blogPosts)
      expect(post!.publishedAt).toBeNull()

      const before = new Date()

      const result = await executeUpdateBlogPost(db, adminId, {
        id: post!.id,
        status: 'published',
      })

      expect(result.ok).toBe(true)

      const [published] = await db
        .select()
        .from(blogPosts)
        .where(eq(blogPosts.id, post!.id))
      expect(published!.status).toBe('published')
      expect(published!.publishedAt).not.toBeNull()
      expect(published!.publishedAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      )
    })

    it('preserves publishedAt on re-publish', async () => {
      const adminId = await seedAdmin(db)

      // Create as published
      await executeCreateBlogPost(db, adminId, {
        title: 'Published Post',
        content: 'content',
        category: 'adventure',
        status: 'published',
      })

      const [post] = await db.select().from(blogPosts)
      const originalPublishedAt = post!.publishedAt!

      // Set back to draft
      await executeUpdateBlogPost(db, adminId, {
        id: post!.id,
        status: 'draft',
      })

      // Re-publish
      await executeUpdateBlogPost(db, adminId, {
        id: post!.id,
        status: 'published',
      })

      const [rePublished] = await db
        .select()
        .from(blogPosts)
        .where(eq(blogPosts.id, post!.id))

      // publishedAt should be preserved (not reset)
      expect(rePublished!.publishedAt!.getTime()).toBe(
        originalPublishedAt.getTime(),
      )
    })

    it('returns error for non-existent post', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeUpdateBlogPost(db, adminId, {
        id: '00000000-0000-0000-0000-000000000000',
        title: 'ghost',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── Delete ────────────────────────────────────────────────────────

  describe('executeDeleteBlogPost', () => {
    it('deletes post and writes audit log', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'To Delete',
        content: 'bye',
        category: 'culture',
      })

      const [post] = await db.select().from(blogPosts)
      const postId = post!.id

      const result = await executeDeleteBlogPost(db, adminId, postId)
      expect(result.ok).toBe(true)

      const remaining = await db.select().from(blogPosts)
      expect(remaining).toHaveLength(0)

      // Audit log for delete
      const logs = await db.select().from(auditLogs)
      const deleteLog = logs.find(
        (l) => l.action === 'admin.blog_post.delete',
      )
      expect(deleteLog).toBeDefined()
      expect(deleteLog!.entityId).toBe(postId)
      expect(deleteLog!.payload).toMatchObject({
        title: 'To Delete',
        slug: 'to-delete',
      })
    })

    it('returns error for non-existent post', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeDeleteBlogPost(
        db,
        adminId,
        '00000000-0000-0000-0000-000000000000',
      )

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('not found')
      }
    })
  })

  // ── Unique slug generation ────────────────────────────────────────

  describe('generateUniqueSlug', () => {
    it('returns base slug when no collision', async () => {
      const adminId = await seedAdmin(db)
      const slug = await generateUniqueSlug(db, 'Unique Title')
      expect(slug).toBe('unique-title')
    })

    it('appends suffix when slug exists', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'Collision Test',
        content: '',
        category: 'guides',
      })

      const slug = await generateUniqueSlug(db, 'Collision Test')
      expect(slug).toBe('collision-test-1')
    })

    it('excludes own ID when checking collisions', async () => {
      const adminId = await seedAdmin(db)

      await executeCreateBlogPost(db, adminId, {
        title: 'Self Slug',
        content: '',
        category: 'tips',
      })

      const [post] = await db.select().from(blogPosts)

      // Same title, but exclude own ID — should return base slug
      const slug = await generateUniqueSlug(db, 'Self Slug', post!.id)
      expect(slug).toBe('self-slug')
    })

    it('falls back to timestamped slug for empty title', async () => {
      const slug = await generateUniqueSlug(db, '')
      expect(slug).toMatch(/^post-\d+$/)
    })
  })
})
