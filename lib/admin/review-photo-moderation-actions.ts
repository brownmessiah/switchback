/**
 * lib/admin/review-photo-moderation-actions — Admin moderation core for
 * Customer-uploaded Review photos (issue 19). Mirrors the existing
 * review-moderation-actions pattern: a pure `execute…(db, adminUserId, id)`
 * core per transition, audit-logged, with a thin admin-permission-gated
 * server-action wrapper in app/admin/reviews.
 *
 * Per DECISION D0/D5 a photo is public ONLY in the 'approved' state. Approve
 * moves pending → approved; reject moves pending → rejected (a moderator can
 * also reject a previously-approved photo to pull it from the public PDP).
 */

import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { experiences } from '@/db/schema/experiences'
import { reviewPhotos } from '@/db/schema/review-photos'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result type ────────────────────────────────────────────────────

export type ReviewPhotoModerationResult =
  | { ok: true }
  | { ok: false; error: string }

// ── Moderation queue loader ────────────────────────────────────────

/**
 * Pending Review photos awaiting moderation, enriched with the parent Review +
 * Experience context for the admin queue table. Newest-pending first.
 */
export async function loadPendingReviewPhotos(db: DBOrTx) {
  return db
    .select({
      id: reviewPhotos.id,
      reviewId: reviewPhotos.reviewId,
      url: reviewPhotos.url,
      status: reviewPhotos.status,
      altText: reviewPhotos.altText,
      createdAt: reviewPhotos.createdAt,
      uploaderName: users.name,
      experienceTitle: experiences.title,
      experienceId: reviews.experienceId,
    })
    .from(reviewPhotos)
    .innerJoin(reviews, eq(reviewPhotos.reviewId, reviews.id))
    .innerJoin(experiences, eq(reviews.experienceId, experiences.id))
    .leftJoin(users, eq(reviewPhotos.uploadedByUserId, users.id))
    .where(eq(reviewPhotos.status, 'pending'))
    .orderBy(desc(reviewPhotos.createdAt))
}

// ── Shared transition helper ───────────────────────────────────────

const idSchema = z.string().uuid('Photo ID must be a valid UUID.')

async function transitionPhoto(
  db: DBOrTx,
  adminUserId: string,
  photoId: string,
  newStatus: 'approved' | 'rejected',
  action: 'admin.review_photo.approve' | 'admin.review_photo.reject',
): Promise<ReviewPhotoModerationResult> {
  const parsed = idSchema.safeParse(photoId)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const [photo] = await db
    .select({ id: reviewPhotos.id, status: reviewPhotos.status })
    .from(reviewPhotos)
    .where(eq(reviewPhotos.id, photoId))
    .limit(1)

  if (!photo) {
    return { ok: false, error: 'Review photo not found.' }
  }

  await db
    .update(reviewPhotos)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(reviewPhotos.id, photoId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action,
    entityType: 'review_photo',
    entityId: photoId,
    payload: { previousStatus: photo.status, newStatus },
  })

  return { ok: true }
}

// ── Approve ────────────────────────────────────────────────────────

export async function executeApproveReviewPhoto(
  db: DBOrTx,
  adminUserId: string,
  photoId: string,
): Promise<ReviewPhotoModerationResult> {
  return transitionPhoto(db, adminUserId, photoId, 'approved', 'admin.review_photo.approve')
}

// ── Reject ─────────────────────────────────────────────────────────

export async function executeRejectReviewPhoto(
  db: DBOrTx,
  adminUserId: string,
  photoId: string,
): Promise<ReviewPhotoModerationResult> {
  return transitionPhoto(db, adminUserId, photoId, 'rejected', 'admin.review_photo.reject')
}
