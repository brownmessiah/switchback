/**
 * lib/reviews/loader — load published Reviews for an Experience, enriched
 * with the derived travel month (Review → Booking → Availability slot, per
 * DECISION D5) and the capture-time group type. Only status='published'
 * reviews are returned. Sorting/filtering for the UI is applied client-side
 * via the pure comparators in ./enrichment.
 */

import { and, desc, eq } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { reviews } from '@/db/schema/reviews'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/media/experience-images'

import { deriveTravelMonth, toGroupType, type EnrichedReview } from './enrichment'

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
  }))
}
