import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { blogPosts } from '@/db/schema/blog-posts'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { getPublishedBlogPostBySlug, listPublishedBlogPosts } from './queries'

describe('blog queries — published-only reader', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@test.com', name: 'Ed Editor' },
      { id: 'u_admin2', email: 'admin2@test.com', name: null },
    ])
    // 3 published (distinct publishedAt) + 1 draft. `author_admin_id` is NOT
    // NULL, so the no-author-name case is a null `users.name` (u_admin2).
    await db.insert(blogPosts).values([
      { title: 'First', slug: 'first', content: '# First\n\nbody', excerpt: 'one', category: 'guides', coverImageUrl: 'https://cdn/1.jpg', status: 'published', publishedAt: new Date('2026-05-01T00:00:00Z'), authorAdminId: 'u_admin' },
      { title: 'Second', slug: 'second', content: '# Second\n\nbody', excerpt: 'two', category: 'tips', status: 'published', publishedAt: new Date('2026-05-10T00:00:00Z'), authorAdminId: 'u_admin' },
      { title: 'Third', slug: 'third', content: '# Third\n\nbody', excerpt: 'three', category: 'tips', status: 'published', publishedAt: new Date('2026-05-20T00:00:00Z'), authorAdminId: 'u_admin2' },
      { title: 'Draft', slug: 'draft-post', content: 'x', excerpt: 'd', category: 'tips', status: 'draft', publishedAt: null, authorAdminId: 'u_admin' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  it('lists only published posts, newest first', async () => {
    const { posts, total } = await listPublishedBlogPosts(db, { page: 1, pageSize: 10 })
    expect(total).toBe(3)
    expect(posts.map((p) => p.slug)).toEqual(['third', 'second', 'first'])
    expect(posts.some((p) => p.slug === 'draft-post')).toBe(false)
  })

  it('paginates', async () => {
    const p1 = await listPublishedBlogPosts(db, { page: 1, pageSize: 2 })
    expect(p1.posts.map((p) => p.slug)).toEqual(['third', 'second'])
    expect(p1.totalPages).toBe(2)
    const p2 = await listPublishedBlogPosts(db, { page: 2, pageSize: 2 })
    expect(p2.posts.map((p) => p.slug)).toEqual(['first'])
  })

  it('returns a published post by slug with author name + markdown content', async () => {
    const post = await getPublishedBlogPostBySlug(db, 'first')
    expect(post).not.toBeNull()
    expect(post!.title).toBe('First')
    expect(post!.content).toContain('# First')
    expect(post!.authorName).toBe('Ed Editor')
    expect(post!.coverImageUrl).toBe('https://cdn/1.jpg')
  })

  it('returns null author name when post has no author', async () => {
    const post = await getPublishedBlogPostBySlug(db, 'third')
    expect(post!.authorName).toBeNull()
  })

  it('returns null for a draft or missing slug', async () => {
    expect(await getPublishedBlogPostBySlug(db, 'draft-post')).toBeNull()
    expect(await getPublishedBlogPostBySlug(db, 'nope')).toBeNull()
  })
})
