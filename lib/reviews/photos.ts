/**
 * lib/reviews/photos — Review-photo attach core + upload/delete server actions
 * (issue 19).
 *
 * A Customer who OWNS a Review (a completed-Booking Review, eligibility
 * enforced at review-create time per ADR-0003) may attach photos. Every
 * attached photo enters status='pending' for moderation through the existing
 * app/admin/reviews queue; per DECISION D0/D5 nothing renders publicly until
 * an Admin approves it.
 *
 * The pure `attachReviewPhoto(db, customerUserId, input)` core is unit-tested
 * directly against PGlite. The injectable `executeUploadReviewPhoto(deps,
 * formData)` core drives the real FormData → storage-adapter → core path; it
 * VALIDATES inputs and verifies Review ownership BEFORE writing to storage so a
 * non-owner (or invalid input) never leaves an orphan object on disk.
 * `uploadReviewPhotoAction` / `deleteReviewPhotoAction` are the thin auth
 * wrappers that resolve the session, prod db, and local adapter, then delegate
 * — mirroring executeUpdateExperience / updateExperienceAction.
 */
'use server'

import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { reviewPhotos } from '@/db/schema/review-photos'
import { reviews } from '@/db/schema/reviews'
import { auth } from '@/lib/auth'
import type { DBOrTx } from '@/lib/media/experience-images'
import type { StorageAdapter } from '@/lib/storage/adapter'
import { LocalFileAdapter } from '@/lib/storage/local'

const attachReviewPhotoSchema = z.object({
  reviewId: z.string().uuid('Invalid review ID.'),
  storageKey: z.string().min(1, 'Storage key is required.'),
  url: z.string().min(1, 'URL is required.'),
  altText: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(280))
    .optional(),
})

export type AttachReviewPhotoInput = z.input<typeof attachReviewPhotoSchema>

export interface AttachedReviewPhoto {
  id: string
  url: string
  storageKey: string
}

export type AttachReviewPhotoResult =
  | { ok: true; photo: AttachedReviewPhoto }
  | { ok: false; error: string }

/**
 * True iff the given Review exists AND belongs to this Customer. Review
 * eligibility (completed Booking) was already enforced at review-create time,
 * so ownership is the only additional gate here. Extracted so the upload action
 * can verify ownership BEFORE touching storage (no orphan files).
 */
export async function customerOwnsReview(
  db: DBOrTx,
  customerUserId: string,
  reviewId: string,
): Promise<boolean> {
  const [review] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.customerUserId, customerUserId)))
    .limit(1)
  return Boolean(review)
}

export async function attachReviewPhoto(
  db: DBOrTx,
  customerUserId: string,
  input: AttachReviewPhotoInput,
): Promise<AttachReviewPhotoResult> {
  const parsed = attachReviewPhotoSchema.safeParse(input)
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Validation failed.' }
  }

  const { reviewId, storageKey, url, altText } = parsed.data

  // Ownership guard (defense-in-depth — the upload action also checks before
  // storing, but the core stands on its own for direct callers and tests).
  if (!(await customerOwnsReview(db, customerUserId, reviewId))) {
    return { ok: false, error: 'Review not found or not authorized.' }
  }

  const [photo] = await db
    .insert(reviewPhotos)
    .values({
      reviewId,
      uploadedByUserId: customerUserId,
      storageKey,
      url,
      altText: altText || null,
      status: 'pending',
    })
    .returning({
      id: reviewPhotos.id,
      url: reviewPhotos.url,
      storageKey: reviewPhotos.storageKey,
    })

  return { ok: true, photo: photo! }
}

// ── Upload server action ─────────────────────────────────────────

export type UploadReviewPhotoResult =
  | { ok: true; photo: AttachedReviewPhoto }
  | { ok: false; error: string }

/**
 * Dependencies the upload/delete cores need, injected so the real
 * FormData → storage-adapter → review_photos path is testable without mocking
 * the session or the prod db handle (mirrors executeUpdateExperience's deps).
 */
export interface ReviewPhotoActionDeps {
  db: DBOrTx
  userId: string
  adapter: StorageAdapter
}

const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Validate the FormData inputs (reviewId present + UUID, a file present that is
 * an image under 10 MB, altText trimmed + ≤280 chars) BEFORE any storage write.
 * Surfaces a Zod failure distinctly so callers don't store-then-reject.
 */
const uploadReviewPhotoInputSchema = z.object({
  reviewId: z.string().uuid('A valid review is required.'),
  altText: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(280, 'Caption must be 280 characters or fewer.'))
    .optional(),
})

/**
 * Injectable core of `uploadReviewPhotoAction`. Validation and Review-ownership
 * are checked BEFORE `adapter.upload`, so an invalid input or a non-owner never
 * writes an orphan object to storage. Only after both gates pass do we store
 * the file and attach the status='pending' row through the owner-gated core
 * (which keeps its own ownership guard as defense-in-depth).
 */
export async function executeUploadReviewPhoto(
  { db, userId, adapter }: ReviewPhotoActionDeps,
  formData: FormData,
): Promise<UploadReviewPhotoResult> {
  const file = formData.get('file')
  const reviewIdRaw = formData.get('reviewId')
  const altTextRaw = formData.get('altText')

  // ── Validate inputs BEFORE touching storage (FIX 2). ──────────────
  if (!(file instanceof File)) {
    return { ok: false, error: 'A photo file is required.' }
  }
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: 'File size must be under 10 MB.' }
  }

  const parsed = uploadReviewPhotoInputSchema.safeParse({
    reviewId: typeof reviewIdRaw === 'string' ? reviewIdRaw : undefined,
    altText: typeof altTextRaw === 'string' ? altTextRaw : undefined,
  })
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]
    return { ok: false, error: firstIssue?.message ?? 'Invalid upload.' }
  }
  const { reviewId, altText } = parsed.data

  // ── Verify Review ownership BEFORE storing the file (FIX 1). ──────
  // A non-owner (or a request for someone else's reviewId) must NOT leave an
  // orphan object on disk, so this gate precedes adapter.upload.
  if (!(await customerOwnsReview(db, userId, reviewId))) {
    return { ok: false, error: 'Review not found or not authorized.' }
  }

  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `reviews/${reviewId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const { url, storageKey } = await adapter.upload(file, key)
    return attachReviewPhoto(db, userId, {
      reviewId,
      storageKey,
      url,
      altText,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Upload failed: ${message}` }
  }
}

/**
 * Customer-facing upload action: stores the file via the storage adapter and
 * attaches a status='pending' review_photos row. Thin auth wrapper that
 * resolves the session, prod db, and local adapter, then delegates to the
 * owner-gated, validate-before-store core. Mirrors uploadExperienceImageAction
 * (FormData(file, reviewId), 10 MB image cap).
 */
export async function uploadReviewPhotoAction(
  formData: FormData,
): Promise<UploadReviewPhotoResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeUploadReviewPhoto(
    { db: prodDb, userId: session.user.id, adapter: new LocalFileAdapter() },
    formData,
  )
}

// ── Delete server action ─────────────────────────────────────────

export type DeleteReviewPhotoResult = { ok: true } | { ok: false; error: string }

/**
 * Injectable core of `deleteReviewPhotoAction`. The uploading Customer may
 * remove their own Review photo (any status); the stored object is deleted
 * before the row so a failure never strands the row pointing at a missing file.
 */
export async function executeDeleteReviewPhoto(
  { db, userId, adapter }: ReviewPhotoActionDeps,
  photoId: string,
): Promise<DeleteReviewPhotoResult> {
  const [photo] = await db
    .select({
      id: reviewPhotos.id,
      storageKey: reviewPhotos.storageKey,
      uploadedByUserId: reviewPhotos.uploadedByUserId,
    })
    .from(reviewPhotos)
    .where(eq(reviewPhotos.id, photoId))
    .limit(1)

  if (!photo) {
    return { ok: false, error: 'Photo not found.' }
  }
  if (photo.uploadedByUserId !== userId) {
    return { ok: false, error: 'Not authorized to delete this photo.' }
  }

  try {
    await adapter.delete(photo.storageKey)
    await db.delete(reviewPhotos).where(eq(reviewPhotos.id, photoId))
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Delete failed: ${message}` }
  }
}

/**
 * Let the uploading Customer remove their own Review photo (any status). Admin
 * moderation (approve/reject) is a separate, admin-gated surface. Thin auth
 * wrapper around executeDeleteReviewPhoto.
 */
export async function deleteReviewPhotoAction(
  photoId: string,
): Promise<DeleteReviewPhotoResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  return executeDeleteReviewPhoto(
    { db: prodDb, userId: session.user.id, adapter: new LocalFileAdapter() },
    photoId,
  )
}
