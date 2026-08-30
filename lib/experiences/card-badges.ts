import { and, eq, inArray, sql } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { reviews } from '@/db/schema/reviews'
import type { DBOrTx } from '@/lib/media/experience-images'
import { loadTrustBadgeFieldResolver } from '@/lib/trust-badges/card-trust-fields'
import type { ExperienceCardData } from '@/components/experience-card'

/**
 * Card social-proof + rating enrichment (parity with switchback.com card tags).
 *
 * Two batch loaders (one group-by query each, no N+1 — mirroring
 * `loadExperienceCoverMap`) plus a pure `deriveHighlight` so a card earns at
 * most ONE social-proof badge. Badges are deliberately sparse: thresholds are
 * pinned in `card-badges.test.ts` and chosen so only genuinely-popular /
 * genuinely-excellent listings qualify.
 *
 * Env-clean: this module touches only the db handle + drizzle, never
 * `lib/env`, so it stays trivially unit-testable against PGlite.
 */

/** Booking states that represent REAL demand (a customer paid + committed). */
const DEMAND_STATES = [
  'confirmed',
  'awaiting_completion',
  'completed',
] as const

/** bookingCount at/above which a listing is a "Bestseller". */
export const BESTSELLER_MIN_BOOKINGS = 6
/** ratingAvg at/above which (with enough reviews) a listing is "Top rated". */
export const TOP_RATED_MIN_AVG = 4.6
/** Minimum published reviews before "Top rated" can fire (avoids 1-review 5★). */
export const TOP_RATED_MIN_COUNT = 5

export interface HighlightInput {
  ratingAvg: number | null
  ratingCount: number
  bookingCount: number
}

/**
 * Resolve the single social-proof badge a card should carry, or `null`.
 * Bestseller (sustained demand) takes precedence over Top rated (excellence).
 */
export function deriveHighlight({
  ratingAvg,
  ratingCount,
  bookingCount,
}: HighlightInput): 'bestseller' | 'top_rated' | null {
  if (bookingCount >= BESTSELLER_MIN_BOOKINGS) return 'bestseller'
  if (
    ratingAvg !== null &&
    ratingAvg >= TOP_RATED_MIN_AVG &&
    ratingCount >= TOP_RATED_MIN_COUNT
  ) {
    return 'top_rated'
  }
  return null
}

/**
 * Batch-load the published-review rating summary for a set of Experiences,
 * keyed by experience id. One group-by over `reviews WHERE status='published'`.
 * `avg` is rounded to 1 decimal place. Experiences with zero published reviews
 * are ABSENT from the map (callers treat absence as "no rating").
 */
export async function loadExperienceRatingMap(
  db: DBOrTx,
  experienceIds: string[],
): Promise<Map<string, { avg: number; count: number }>> {
  const map = new Map<string, { avg: number; count: number }>()
  if (experienceIds.length === 0) return map

  const rows = await db
    .select({
      experienceId: reviews.experienceId,
      avg: sql<number>`avg(${reviews.rating})::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.status, 'published'),
        inArray(reviews.experienceId, experienceIds),
      ),
    )
    .groupBy(reviews.experienceId)

  for (const r of rows) {
    map.set(r.experienceId, {
      avg: Math.round(Number(r.avg) * 10) / 10,
      count: Number(r.count),
    })
  }
  return map
}

/**
 * Batch-load the count of real-demand Bookings per Experience, keyed by id.
 * Counts confirmed + awaiting_completion + completed (cancelled / no-show /
 * pending_payment are excluded — they are not demand signal). Experiences with
 * zero demand bookings are ABSENT from the map.
 */
export async function loadExperienceBookingCountMap(
  db: DBOrTx,
  experienceIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (experienceIds.length === 0) return map

  const rows = await db
    .select({
      experienceId: bookings.experienceId,
      count: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .where(
      and(
        inArray(bookings.state, [...DEMAND_STATES]),
        inArray(bookings.experienceId, experienceIds),
      ),
    )
    .groupBy(bookings.experienceId)

  for (const r of rows) {
    map.set(r.experienceId, Number(r.count))
  }
  return map
}

export interface CardBadgeFields {
  ratingAvg: number | null
  ratingCount: number
  highlight: 'bestseller' | 'top_rated' | null
}

/**
 * Load both batch maps for a set of ids and return a per-id resolver that
 * yields the `{ ratingAvg, ratingCount, highlight }` triple. Loaders that
 * return domain-specific row shapes (home, destinations, collections, vendor)
 * use this to stay DRY without reshaping into `ExperienceCardData` first.
 */
export async function loadCardBadgeResolver(
  db: DBOrTx,
  experienceIds: string[],
): Promise<(id: string) => CardBadgeFields> {
  const [ratingMap, bookingMap] = await Promise.all([
    loadExperienceRatingMap(db, experienceIds),
    loadExperienceBookingCountMap(db, experienceIds),
  ])
  return (id: string): CardBadgeFields => {
    const rating = ratingMap.get(id)
    const ratingCount = rating?.count ?? 0
    const ratingAvg = rating?.avg ?? null
    return {
      ratingAvg,
      ratingCount,
      highlight: deriveHighlight({
        ratingAvg,
        ratingCount,
        bookingCount: bookingMap.get(id) ?? 0,
      }),
    }
  }
}

/**
 * Enrich a list of cards with `ratingAvg` / `ratingCount` / `highlight` PLUS
 * the issue-05 trust-badge backing fields (cancellationPreset,
 * requiresSafetyStack, paymentModesAllowed, vendorKycTier), loading the batch
 * maps in parallel for the page's ids. `difficulty` is left untouched — callers
 * set it from their own `experiences.difficulty` select. Returns NEW card
 * objects (immutable); cards with no rating/demand are returned unchanged in
 * those fields (bare cards render as before).
 */
export async function enrichCardBadges(
  db: DBOrTx,
  cards: ExperienceCardData[],
): Promise<ExperienceCardData[]> {
  if (cards.length === 0) return cards

  const ids = cards.map((c) => c.id)
  const [resolve, resolveTrust] = await Promise.all([
    loadCardBadgeResolver(db, ids),
    loadTrustBadgeFieldResolver(db, ids),
  ])

  return cards.map((card) => ({
    ...card,
    ...resolve(card.id),
    ...resolveTrust(card.id),
  }))
}
