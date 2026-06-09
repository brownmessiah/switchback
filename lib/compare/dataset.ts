import { and, eq, inArray } from 'drizzle-orm'

import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { loadExperienceRatingMap } from '@/lib/experiences/card-badges'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import { COMPARE_MAX } from './storage'

/**
 * Comparison-dataset builder for the dedicated `/compare` page (DECISION D10).
 *
 * The input `slugs` come from the visitor's localStorage (insertion order) and
 * are therefore UNTRUSTED — a slug may be stale (now draft / paused /
 * archived), may be an admin/E2E fixture, or may not exist at all. This builder
 * is the gate: it fetches only the slugs that are publicly visible
 * (`publiclyVisibleExperienceCondition()` — `status='published'` AND
 * non-fixture, the single source of truth in `lib/experiences/public-filter`),
 * so the comparison can NEVER surface a fixture / unpublished listing even with
 * a stale slug in storage (guardrail D0).
 *
 * The DB returns rows in arbitrary order; we re-sort to match the caller's
 * selection order so the comparison columns render left-to-right in the order
 * the visitor added them. The result is capped to `COMPARE_MAX` defensively
 * (storage already caps, but the builder must not over-render if a tampered
 * list slips through).
 *
 * The ten compared fields (DECISION D10):
 *   1. price            — the three group-size brackets (ADR-0011), in rupees
 *   2. duration         — `durationMinutes` (the page formats via formatDuration)
 *   3. difficulty       — `difficulty` enum (nullable)
 *   4. inclusions       — `inclusions` text[] (nullable / empty)
 *   5. cancellation     — `cancellationPreset` enum (labelled "Flexible
 *                         cancellation" etc — NEVER "free")
 *   6. rating           — published-review aggregate (avg + count)
 *   7. KYC verification — the Vendor's `kycTier`
 *   8. min age          — `minAge` (nullable)
 *   9. group size       — the 1-2 / 3-5 / 6+ brackets (the priceBrackets keys)
 *  10. Vendor           — display name + storefront slug (links to /vendor/{slug})
 */

/** Difficulty enum values an Experience may carry (nullable). */
export type CompareDifficulty = 'easy' | 'moderate' | 'challenging' | 'extreme'

/** Cancellation preset values (ADR-0005). Labelled "Flexible cancellation" etc. */
export type CompareCancellationPreset = 'flexible' | 'moderate' | 'strict' | 'custom'

/** The Vendor KYC tiers (ADR-0007). `phone` carries no verified badge. */
export type CompareKycTier = 'phone' | 'identity' | 'business'

/** The three mandatory group-size price brackets (ADR-0011), in whole rupees. */
export interface ComparePriceBrackets {
  from1to2: number
  from3to5: number
  from6plus: number
}

/** One Experience column in the side-by-side comparison. */
export interface ComparisonRow {
  id: string
  slug: string
  title: string
  /** 1. price — the three group-size brackets (ADR-0011). */
  priceBrackets: ComparePriceBrackets
  /** 2. duration — raw minutes (page formats via formatDuration). */
  durationMinutes: number | null
  /** 3. difficulty (nullable). */
  difficulty: CompareDifficulty | null
  /** 4. inclusions (nullable → empty array). */
  inclusions: string[]
  /** 5. cancellation preset — NEVER "free". */
  cancellationPreset: CompareCancellationPreset
  /** 6. rating — published-review aggregate. */
  ratingAvg: number | null
  ratingCount: number
  /** 7. KYC verification — the Vendor's kyc tier. */
  vendorKycTier: CompareKycTier
  /** 8. min age (nullable). */
  minAge: number | null
  /** 10. Vendor display name + storefront slug. */
  vendorName: string
  vendorSlug: string
}

export async function buildComparisonDataset(
  db: DBOrTx,
  slugs: readonly string[],
): Promise<ComparisonRow[]> {
  if (slugs.length === 0) return []

  // De-dupe defensively (storage dedupes, but a malformed list could slip a
  // repeat through), keeping the first occurrence's position, then cap.
  const orderedSlugs = slugs
    .filter((slug, i) => slugs.indexOf(slug) === i)
    .slice(0, COMPARE_MAX)

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
      durationMinutes: experiences.durationMinutes,
      difficulty: experiences.difficulty,
      inclusions: experiences.inclusions,
      cancellationPreset: experiences.cancellationPreset,
      minAge: experiences.minAge,
      vendorName: vendorProfiles.businessName,
      vendorSlug: vendorProfiles.slug,
      vendorKycTier: vendorProfiles.kycTier,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(
      and(
        inArray(experiences.slug, [...orderedSlugs]),
        publiclyVisibleExperienceCondition(),
      ),
    )

  if (rows.length === 0) return []

  const ratingMap = await loadExperienceRatingMap(
    db,
    rows.map((r) => r.id),
  )

  const rowsBySlug = new Map<string, ComparisonRow>(
    rows.map((row) => {
      const rating = ratingMap.get(row.id)
      return [
        row.slug,
        {
          id: row.id,
          slug: row.slug,
          title: row.title,
          priceBrackets: {
            from1to2: Math.floor(Number(row.pricePerPerson_1_2)),
            from3to5: Math.floor(Number(row.pricePerPerson_3_5)),
            from6plus: Math.floor(Number(row.pricePerPerson_6_plus)),
          },
          durationMinutes: row.durationMinutes,
          difficulty: row.difficulty as CompareDifficulty | null,
          inclusions: row.inclusions ?? [],
          cancellationPreset: row.cancellationPreset as CompareCancellationPreset,
          ratingAvg: rating?.avg ?? null,
          ratingCount: rating?.count ?? 0,
          vendorKycTier: row.vendorKycTier as CompareKycTier,
          minAge: row.minAge,
          vendorName: row.vendorName,
          vendorSlug: row.vendorSlug,
        },
      ]
    }),
  )

  // Re-order to match the visitor's selection order, dropping slugs that did not
  // resolve (stale / gated-out).
  return orderedSlugs
    .map((slug) => rowsBySlug.get(slug))
    .filter((row): row is ComparisonRow => row !== undefined)
}
