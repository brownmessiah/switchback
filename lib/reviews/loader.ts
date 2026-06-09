/**
 * lib/reviews/loader — load published Reviews for an Experience, enriched
 * with the derived travel month (Review → Booking → Availability slot, per
 * DECISION D5) and the capture-time group type. Only status='published'
 * reviews are returned. Sorting/filtering for the UI is applied client-side
 * via the pure comparators in ./enrichment.
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { reviewPhotos } from '@/db/schema/review-photos'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/media/experience-images'

import {
  deriveTravelMonth,
  toGroupType,
  type EnrichedReview,
  type ReviewPhotoSummary,
} from './enrichment'

/**
 * Batch-load APPROVED Review photos for a set of reviews, keyed by reviewId.
 * Only status='approved' photos are returned (DECISION D0/D5 — no unmoderated
 * user image is ever public). One query for the whole page avoids N+1.
 */
async function loadApprovedPhotosByReview(
  db: DBOrTx,
  reviewIds: string[],
): Promise<Map<string, ReviewPhotoSummary[]>> {
  const map = new Map<string, ReviewPhotoSummary[]>()
  if (reviewIds.length === 0) return map

  const rows = await db
    .select({
      id: reviewPhotos.id,
      reviewId: reviewPhotos.reviewId,
      url: reviewPhotos.url,
      altText: reviewPhotos.altText,
    })
    .from(reviewPhotos)
    .where(
      and(
        inArray(reviewPhotos.reviewId, reviewIds),
        eq(reviewPhotos.status, 'approved'),
      ),
    )
    .orderBy(asc(reviewPhotos.createdAt), asc(reviewPhotos.id))

  for (const r of rows) {
    const list = map.get(r.reviewId) ?? []
    list.push({ id: r.id, url: r.url, altText: r.altText })
    map.set(r.reviewId, list)
  }
  return map
}

const DEFAULT_LIMIT = 20

export async function loadPublishedReviews(
  db: DBOrTx,
  experienceId: string,
  limit = DEFAULT_LIMIT,
): Promise<EnrichedReview[]> {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      title: reviews.title,
      body: reviews.body,
      status: reviews.status,
      groupType: reviews.groupType,
      createdAt: reviews.createdAt,
      customerName: users.name,
      slotStartAt: availabilitySlots.startAt,
    })
    .from(reviews)
    .innerJoin(users, eq(reviews.customerUserId, users.id))
    .innerJoin(bookings, eq(reviews.bookingId, bookings.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(and(eq(reviews.experienceId, experienceId), eq(reviews.status, 'published')))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)

  const photosByReview = await loadApprovedPhotosByReview(
    db,
    rows.map((r) => r.id),
  )

  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    title: r.title,
    body: r.body,
    customerName: r.customerName ?? 'Customer',
    createdAt: r.createdAt,
    status: r.status,
    travelMonth: deriveTravelMonth(r.slotStartAt),
    groupType: toGroupType(r.groupType),
    photos: photosByReview.get(r.id) ?? [],
  }))
}
