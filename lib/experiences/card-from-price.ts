import { and, eq, inArray, min } from 'drizzle-orm'

import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Batch "From ₹X" resolver for listing cards (ADR-0011 revision 2026-06-16,
 * issue #08). For a set of Experience ids, returns a lookup giving the LOWEST
 * ACTIVE pricing-variation price in whole rupees, or `null` when the Experience
 * has no active variations (the card then shows its plain base/bracket price).
 *
 * One GROUP BY for the whole card grid — no N+1. Mirrors the
 * `loadCardBadgeResolver` shape so card builders compose the same way. The
 * card itself only renders "From ₹X" when this value is strictly BELOW the
 * base price, so bracket-only experiences are unaffected.
 */
export async function loadCardFromPriceResolver(
  db: DBOrTx,
  experienceIds: string[],
): Promise<(id: string) => number | null> {
  if (experienceIds.length === 0) {
    return () => null
  }

  const rows = await db
    .select({
      experienceId: experiencePricingVariations.experienceId,
      // numeric(12,2) MIN — drizzle returns it as a string; coerce below.
      minPrice: min(experiencePricingVariations.pricePerPerson),
    })
    .from(experiencePricingVariations)
    .where(
      and(
        inArray(experiencePricingVariations.experienceId, experienceIds),
        eq(experiencePricingVariations.isActive, true),
      ),
    )
    .groupBy(experiencePricingVariations.experienceId)

  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.minPrice == null) continue
    map.set(row.experienceId, Math.floor(Number(row.minPrice)))
  }

  return (id: string): number | null => map.get(id) ?? null
}
