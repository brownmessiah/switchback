/**
 * Vendor rating aggregate (issue 21 / ADR-0013, D0).
 *
 * Computes the AggregateRating that backs a Vendor profile's
 * LocalBusiness/Organization JSON-LD: the average + count of REAL published
 * reviews across all of the Vendor's experiences. Returns `null` when the
 * Vendor has no published reviews so the schema generator omits the
 * `aggregateRating` block entirely — never a fabricated rating.
 */

import { and, eq, sql } from 'drizzle-orm'

import { reviews } from '@/db/schema/reviews'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

export interface VendorRatingAggregate {
  /** Average rating 0..5, rounded to one decimal place. */
  ratingValue: number
  /** Count of published reviews. Always > 0 when non-null. */
  ratingCount: number
}

export async function loadVendorRatingAggregate(
  db: DBOrTx,
  vendorUserId: string,
): Promise<VendorRatingAggregate | null> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      avg: sql<number | null>`avg(${reviews.rating})`,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.vendorUserId, vendorUserId),
        eq(reviews.status, 'published'),
      ),
    )

  const count = row?.count ?? 0
  if (count === 0 || row?.avg == null) {
    return null
  }

  return {
    ratingValue: Math.round(Number(row.avg) * 10) / 10,
    ratingCount: count,
  }
}
