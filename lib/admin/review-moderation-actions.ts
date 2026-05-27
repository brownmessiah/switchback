import { and, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'

import { experiences } from '@/db/schema/experiences'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Result type ────────────────────────────────────────────────────

export type ReviewModerationResult = { ok: true } | { ok: false; error: string }

// ── Valid transitions ──────────────────────────────────────────────

/**
 * Review status per schema: pending, published, flagged, removed.
 *
 * Admin moderation transitions:
 *   - flag:    pending | published → flagged
 *   - remove:  pending | published | flagged → removed
 *   - publish: pending | flagged → published
 */
const FLAG_FROM = ['pending', 'published'] as const
const REMOVE_FROM = ['pending', 'published', 'flagged'] as const
const PUBLISH_FROM = ['pending', 'flagged'] as const

// ── Filters ────────────────────────────────────────────────────────

export interface ReviewListFilters {
  rating?: number
  status?: string
}

// ── List loader ────────────────────────────────────────────────────

export async function loadReviewsList(db: DBOrTx, filters: ReviewListFilters = {}) {
  const conditions: SQL[] = []

  if (filters.rating !== undefined && filters.rating !== null) {
    conditions.push(eq(reviews.rating, filters.rating))
  }
  if (filters.status) {
    conditions.push(
      eq(reviews.status, filters.status as 'pending' | 'published' | 'flagged' | 'removed'),
    )
  }

  return db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      vendorResponse: reviews.vendorResponse,
      vendorRespondedAt: reviews.vendorRespondedAt,
      createdAt: reviews.createdAt,
      customerName: users.name,
      customerEmail: users.email,
      experienceTitle: experiences.title,
      experienceId: reviews.experienceId,
      vendorBusinessName: vendorProfiles.businessName,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.customerUserId, users.id))
    .innerJoin(experiences, eq(reviews.experienceId, experiences.id))
    .innerJoin(vendorProfiles, eq(reviews.vendorUserId, vendorProfiles.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(reviews.createdAt))
}

// ── Flag ───────────────────────────────────────────────────────────

export async function executeFlagReview(
  db: DBOrTx,
  adminUserId: string,
  reviewId: string,
): Promise<ReviewModerationResult> {
  const idSchema = z.string().uuid('Review ID must be a valid UUID.')
  const parsed = idSchema.safeParse(reviewId)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const [review] = await db
    .select({ id: reviews.id, status: reviews.status })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1)

  if (!review) {
    return { ok: false, error: 'Review not found.' }
  }

  if (!(FLAG_FROM as readonly string[]).includes(review.status)) {
    return {
      ok: false,
      error: `Cannot flag: review must be pending or published (current: ${review.status}).`,
    }
  }

  await db
    .update(reviews)
    .set({ status: 'flagged', updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.review.flag',
    entityType: 'review',
    entityId: reviewId,
    payload: { previousStatus: review.status, newStatus: 'flagged' },
  })

  return { ok: true }
}

// ── Remove ─────────────────────────────────────────────────────────

export async function executeRemoveReview(
  db: DBOrTx,
  adminUserId: string,
  reviewId: string,
): Promise<ReviewModerationResult> {
  const idSchema = z.string().uuid('Review ID must be a valid UUID.')
  const parsed = idSchema.safeParse(reviewId)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const [review] = await db
    .select({ id: reviews.id, status: reviews.status })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1)

  if (!review) {
    return { ok: false, error: 'Review not found.' }
  }

  if (!(REMOVE_FROM as readonly string[]).includes(review.status)) {
    return {
      ok: false,
      error: `Cannot remove: review is already removed (current: ${review.status}).`,
    }
  }

  await db
    .update(reviews)
    .set({ status: 'removed', updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.review.remove',
    entityType: 'review',
    entityId: reviewId,
    payload: { previousStatus: review.status, newStatus: 'removed' },
  })

  return { ok: true }
}

// ── Publish ────────────────────────────────────────────────────────

export async function executePublishReview(
  db: DBOrTx,
  adminUserId: string,
  reviewId: string,
): Promise<ReviewModerationResult> {
  const idSchema = z.string().uuid('Review ID must be a valid UUID.')
  const parsed = idSchema.safeParse(reviewId)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Validation failed.' }
  }

  const [review] = await db
    .select({ id: reviews.id, status: reviews.status })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1)

  if (!review) {
    return { ok: false, error: 'Review not found.' }
  }

  if (!(PUBLISH_FROM as readonly string[]).includes(review.status)) {
    return {
      ok: false,
      error: `Cannot publish: review must be pending or flagged (current: ${review.status}).`,
    }
  }

  await db
    .update(reviews)
    .set({ status: 'published', updatedAt: new Date() })
    .where(eq(reviews.id, reviewId))

  await writeAuditLog(db, {
    actorUserId: adminUserId,
    action: 'admin.review.publish',
    entityType: 'review',
    entityId: reviewId,
    payload: { previousStatus: review.status, newStatus: 'published' },
  })

  return { ok: true }
}
