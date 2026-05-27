'use server'

import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { blogPosts, BLOG_CATEGORIES, BLOG_STATUSES } from '@/db/schema/blog-posts'
import { mediaAssets } from '@/db/schema/media-assets'
import { auth } from '@/lib/auth'
import { writeAuditLog } from '@/lib/audit/write'
import { LocalFileAdapter } from '@/lib/storage/local'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result types ────────────────────────────────────────────────────

export type BlogActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

// ── Slug generation ─────────────────────────────────────────────────

/**
 * Generate a URL-safe slug from a title.
 * - Lowercases, strips non-alphanumeric (except spaces/hyphens),
 *   collapses consecutive hyphens, trims leading/trailing hyphens.
 */
export async function generateSlug(title: string): Promise<string> {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Generate a unique slug by appending a numeric suffix when collisions
 * exist. Checks the database for existing slugs matching the base.
 */
export async function generateUniqueSlug(
  db: DBOrTx,
  title: string,
  excludeId?: string,
): Promise<string> {
  const base = await generateSlug(title)
  if (!base) return `post-${Date.now()}`

  let candidate = base
  let attempt = 0

  while (true) {
    const conditions = excludeId
      ? sql`${blogPosts.slug} = ${candidate} AND ${blogPosts.id} != ${excludeId}`
      : sql`${blogPosts.slug} = ${candidate}`

    const [existing] = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(conditions)
      .limit(1)

    if (!existing) return candidate

    attempt += 1
    candidate = `${base}-${attempt}`
  }
}

// ── Validation schemas ─────────────────────────────────────────────

const createSchema = z.object({
  title: z.string().trim().min(1, 'Title is required.').max(300),
  content: z.string().default(''),
  excerpt: z.string().max(500).nullable().optional(),
  category: z.enum(BLOG_CATEGORIES, { message: 'Invalid category.' }),
  coverImageUrl: z.string().url().nullable().optional(),
  status: z.enum(BLOG_STATUSES).default('draft'),
})

export type CreateBlogPostInput = z.input<typeof createSchema>

const updateSchema = z.object({
  id: z.string().uuid('Post ID must be a valid UUID.'),
  title: z.string().trim().min(1, 'Title is required.').max(300).optional(),
  content: z.string().optional(),
  excerpt: z.string().max(500).nullable().optional(),
  category: z.enum(BLOG_CATEGORIES, { message: 'Invalid category.' }).optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  status: z.enum(BLOG_STATUSES).optional(),
})

export type UpdateBlogPostInput = z.infer<typeof updateSchema>

// ── Core testable: create blog post ─────────────────────────────────

export async function executeCreateBlogPost(
  db: DBOrTx,
  adminUserId: string,
  input: CreateBlogPostInput,
): Promise<BlogActionResult> {
  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { title, content, excerpt, category, coverImageUrl, status } = parsed.data

  const slug = await generateUniqueSlug(db, title)

  const publishedAt =
    status === 'published' ? new Date() : null

  const [post] = await db
    .insert(blogPosts)
    .values({
      title,
      slug,
      content,
      excerpt: excerpt ?? null,
      category,
      coverImageUrl: coverImageUrl ?? null,
      status,
      publishedAt,
      authorAdminId: adminUserId,
    })
    .returning({ id: blogPosts.id })

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.blog_post.create',
    entityType: 'blog_post',
    entityId: post!.id,
    payload: { title, slug, category, status },
  })

  return { ok: true, id: post!.id }
}

// ── Core testable: update blog post ─────────────────────────────────

export async function executeUpdateBlogPost(
  db: DBOrTx,
  adminUserId: string,
  input: UpdateBlogPostInput,
): Promise<BlogActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const { id, ...fields } = parsed.data

  const [existing] = await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, id))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Blog post not found.' }
  }

  const updateSet: Record<string, unknown> = {
    updatedAt: sql`now()`,
  }

  if (fields.title !== undefined) {
    updateSet.title = fields.title
    // Re-generate slug when title changes
    updateSet.slug = await generateUniqueSlug(db, fields.title, id)
  }
  if (fields.content !== undefined) updateSet.content = fields.content
  if (fields.excerpt !== undefined) updateSet.excerpt = fields.excerpt ?? null
  if (fields.category !== undefined) updateSet.category = fields.category
  if (fields.coverImageUrl !== undefined) updateSet.coverImageUrl = fields.coverImageUrl ?? null

  if (fields.status !== undefined) {
    updateSet.status = fields.status
    // Set publishedAt on first publish, preserve on re-publish
    if (fields.status === 'published' && !existing.publishedAt) {
      updateSet.publishedAt = new Date()
    }
  }

  await db
    .update(blogPosts)
    .set(updateSet)
    .where(eq(blogPosts.id, id))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.blog_post.update',
    entityType: 'blog_post',
    entityId: id,
    payload: { previousTitle: existing.title, ...fields },
  })

  return { ok: true }
}

// ── Core testable: delete blog post ─────────────────────────────────

export async function executeDeleteBlogPost(
  db: DBOrTx,
  adminUserId: string,
  postId: string,
): Promise<BlogActionResult> {
  if (!postId) {
    return { ok: false, error: 'Post ID is required.' }
  }

  const [existing] = await db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.id, postId))
    .limit(1)

  if (!existing) {
    return { ok: false, error: 'Blog post not found.' }
  }

  await db.delete(blogPosts).where(eq(blogPosts.id, postId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.blog_post.delete',
    entityType: 'blog_post',
    entityId: postId,
    payload: { title: existing.title, slug: existing.slug },
  })

  return { ok: true }
}

// ── Server Action wrappers (Next.js boundary) ─────────────────────

export async function createBlogPost(
  input: CreateBlogPostInput,
): Promise<BlogActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeCreateBlogPost(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/blog')
  }
  return result
}

export async function updateBlogPost(
  input: UpdateBlogPostInput,
): Promise<BlogActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeUpdateBlogPost(prodDb, session.user.id, input)

  if (result.ok) {
    revalidatePath('/admin/blog')
  }
  return result
}

export async function deleteBlogPost(
  postId: string,
): Promise<BlogActionResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return { ok: false, error: 'Not authenticated.' }

  const result = await executeDeleteBlogPost(prodDb, session.user.id, postId)

  if (result.ok) {
    revalidatePath('/admin/blog')
  }
  return result
}

// ── Cover image upload ──────────────────────────────────────────────

type UploadCoverImageResult =
  | { ok: true; asset: { id: string; url: string; storageKey: string } }
  | { ok: false; error: string }

export async function uploadBlogCoverImage(
  formData: FormData,
): Promise<UploadCoverImageResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Not authenticated.' }
  }

  const file = formData.get('file') as File | null
  const postId = formData.get('postId') as string | null

  if (!file) {
    return { ok: false, error: 'File is required.' }
  }

  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed.' }
  }

  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'File size must be under 10 MB.' }
  }

  const adapter = new LocalFileAdapter()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `blog/${postId ?? 'new'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const { url, storageKey } = await adapter.upload(file, key)

    const [asset] = await prodDb
      .insert(mediaAssets)
      .values({
        uploadedBy: session.user.id,
        storageKey,
        url,
        contentType: file.type,
        sizeBytes: file.size,
        entityType: 'blog',
        entityId: postId ?? 'pending',
      })
      .returning({
        id: mediaAssets.id,
        url: mediaAssets.url,
        storageKey: mediaAssets.storageKey,
      })

    return { ok: true, asset }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Upload failed: ${message}` }
  }
}
