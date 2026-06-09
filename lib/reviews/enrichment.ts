/**
 * lib/reviews — pure Review enrichment + sort/filter logic (issue 18).
 *
 * Per DECISION D5 the traveller's "travel month" is DERIVED from the
 * Booking's Availability slot start_at (NO new column), the capture-time
 * group-type is a passthrough, and the published-only filter plus the
 * recent/highest/lowest sort comparators live here as pure functions so they
 * can be unit-tested directly and reused by the loader and the client
 * sort/filter control.
 *
 * Review photos and the with-photos filter land in issue #19.
 */

import type { Review } from '@/db/schema/reviews'

/**
 * Capture-time group types (ADR domain vocabulary). Order is load-bearing —
 * it matches the `review_group_type` Postgres enum in
 * db/migrations/0024_review_group_type.sql and the form select order.
 */
export const REVIEW_GROUP_TYPES = [
  'solo',
  'couple',
  'friends',
  'family',
  'corporate',
] as const

export type ReviewGroupType = (typeof REVIEW_GROUP_TYPES)[number]

/** Sort modes surfaced on the PDP. with-photos comes in #19. */
export const REVIEW_SORTS = ['recent', 'highest', 'lowest'] as const

export type ReviewSort = (typeof REVIEW_SORTS)[number]

export const DEFAULT_REVIEW_SORT: ReviewSort = 'recent'

/** IANA zone the platform reports traveller-local dates in (IST). */
const TRAVEL_MONTH_TIME_ZONE = 'Asia/Kolkata'

/**
 * A published Review enriched for display: the derived travel month (1-based,
 * or null when the slot date is unknown) and the capture-time group type.
 */
export interface EnrichedReview {
  id: string
  rating: number
  title: string | null
  body: string | null
  customerName: string
  createdAt: Date
  status: Review['status']
  /** 1 (January) … 12 (December), or null when no slot date is available. */
  travelMonth: number | null
  groupType: ReviewGroupType | null
}

/**
 * Derive the 1-based travel month from the Booking's Availability slot
 * start_at, in IST so a late-evening UTC slot keeps the traveller's local
 * month. Returns null when there is no slot date.
 */
export function deriveTravelMonth(
  slotStartAt: Date | null | undefined,
): number | null {
  if (!slotStartAt) {
    return null
  }
  // Intl gives us the IST-local month without pulling in a date library.
  const month = new Intl.DateTimeFormat('en-US', {
    timeZone: TRAVEL_MONTH_TIME_ZONE,
    month: 'numeric',
  }).format(slotStartAt)
  return Number(month)
}

/** Type guard: only `status === 'published'` reviews render. */
export function isPublished<T extends { status: Review['status'] }>(
  review: T,
): boolean {
  return review.status === 'published'
}

/** Coerce a raw DB value into a known group type, else null. */
export function toGroupType(value: string | null | undefined): ReviewGroupType | null {
  return REVIEW_GROUP_TYPES.includes(value as ReviewGroupType)
    ? (value as ReviewGroupType)
    : null
}

/** Narrow an arbitrary string into a valid sort mode, falling back to default. */
export function toReviewSort(value: string | null | undefined): ReviewSort {
  return REVIEW_SORTS.includes(value as ReviewSort)
    ? (value as ReviewSort)
    : DEFAULT_REVIEW_SORT
}

function recencyTieBreak(a: EnrichedReview, b: EnrichedReview): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
}

/**
 * Return a NEW array sorted by the chosen mode (input is never mutated):
 *  - recent:  newest createdAt first
 *  - highest: highest rating first, recency tie-break
 *  - lowest:  lowest rating first, recency tie-break
 */
export function sortReviews<T extends EnrichedReview>(
  reviews: readonly T[],
  sort: ReviewSort,
): T[] {
  const copy = [...reviews]
  switch (sort) {
    case 'highest':
      return copy.sort((a, b) => b.rating - a.rating || recencyTieBreak(a, b))
    case 'lowest':
      return copy.sort((a, b) => a.rating - b.rating || recencyTieBreak(a, b))
    case 'recent':
    default:
      return copy.sort(recencyTieBreak)
  }
}
