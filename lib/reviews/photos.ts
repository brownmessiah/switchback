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
 * directly against PGlite. `uploadReviewPhotoAction` is the thin auth wrapper:
 * it gates on session + Review ownership, stores the file via the storage
 * adapter (mirroring uploadExperienceImageAction), then calls the core.
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

  // The Review must exist and belong to this Customer. Review eligibility
  // (completed Booking) was already enforced when the Review was created, so
  // ownership is the only additional gate here.
  const [review] = await db
    .select({ id: reviews.id, customerUserId: reviews.customerUserId })
    .from(reviews)
    .where(and(eq(reviews.id, reviewId), eq(reviews.customerUserId, customerUserId)))
    .limit(1)

  if (!review) {
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
 * Customer-facing upload action: stores the file via the storage adapter and
 * attaches a status='pending' review_photos row through the owner-gated core.
 * Mirrors uploadExperienceImageAction (FormData(file, reviewId), 10MB image
 * cap). Ownership is enforced inside attachReviewPhoto.
 */
export async function uploadReviewPhotoAction(
  formData: FormData,
): Promise<UploadReviewPhotoResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  const file = formData.get('file') as File | null
  const reviewId = formData.get('reviewId') as string | null
  const altText = formData.get('altText') as string | null

  if (!file || !reviewId) {
    return { ok: false, error: 'File and review ID are required.' }
  }
  if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Only image files are allowed.' }
  }
  if (file.size > 10 * 1024 * 1024) {
    return { ok: false, error: 'File size must be under 10 MB.' }
  }

  const adapter = new LocalFileAdapter()
  const ext = file.name.split('.').pop() ?? 'jpg'
  const key = `reviews/${reviewId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  try {
    const { url, storageKey } = await adapter.upload(file, key)
    return attachReviewPhoto(prodDb, session.user.id, {
      reviewId,
      storageKey,
      url,
      altText: altText ?? undefined,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Upload failed: ${message}` }
  }
}

// ── Delete server action ─────────────────────────────────────────

export type DeleteReviewPhotoResult = { ok: true } | { ok: false; error: string }

/**
 * Let the uploading Customer remove their own Review photo (any status). Admin
 * moderation (approve/reject) is a separate, admin-gated surface.
 */
export async function deleteReviewPhotoAction(
  photoId: string,
): Promise<DeleteReviewPhotoResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'Sign in to continue.' }
  }

  const [photo] = await prodDb
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
  if (photo.uploadedByUserId !== session.user.id) {
    return { ok: false, error: 'Not authorized to delete this photo.' }
  }

  const adapter = new LocalFileAdapter()
  try {
    await adapter.delete(photo.storageKey)
    await prodDb.delete(reviewPhotos).where(eq(reviewPhotos.id, photoId))
    return { ok: true }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Delete failed: ${message}` }
  }
}
