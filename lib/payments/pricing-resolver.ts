import { and, eq, gt, lte, sql } from 'drizzle-orm'

import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { pricingTiers } from '@/db/schema/pricing-tiers'

import type { DBOrTx } from './commission-resolver'

/**
 * Pricing-resolution result snapshotted onto bookings.price_per_participant_snapshot
 * + pricing_basis_snapshot at Booking-create.
 *
 * `pricePerParticipant` is numeric(12,2) as a string — never JS floats.
 * `basis` is the audit label identifying which arm fired
 * (`pricing_variation:<id>` | `pricing_tier:<name>` | `experience_bracket:1_2`
 *  | `experience_bracket:3_5` | `experience_bracket:6_plus`).
 */
export interface ResolvedPricing {
  pricePerParticipant: string
  basis: string
}

interface ResolvePricingArgs {
  experienceId: string
  participantCount: number
  now?: Date
  /**
   * Optional Customer-selected pricing variation (ADR-0011 revision
   * 2026-06-16, issue #07). When supplied it MUST be a valid, ACTIVE variation
   * belonging to `experienceId` — an unknown / foreign / inactive id is
   * REJECTED (throws), never silently downgraded to the tier/bracket chain.
   * On success the variation's `price_per_person` is the resolved price.
   */
  variationId?: string
}

/**
 * Resolve the per-participant price that applies to a Booking on the
 * given Experience for the given participant count as of `now`. Walks
 * the chain per ADR-0011 (revision 2026-06-16):
 *
 *   0. Selected pricing variation (experience_pricing_variations; when a valid
 *      ACTIVE variationId belonging to the Experience is supplied — TOP
 *      precedence; an invalid id is REJECTED, not downgraded). (issue #07)
 *   1. Active pricing tier (pricing_tiers; most-recently-created among
 *      matches; scope-filtered by category/vendor/experience).
 *   2. Slot-specific override (NOT YET IMPLEMENTED; v1.x).
 *   3. Experience tier-based price (group-size bracket fired by
 *      participantCount: 1-2 / 3-5 / 6+).
 *
 * Returns the first non-null arm. The Experience always has the three
 * brackets populated (NOT NULL at schema) so the function never falls
 * through past the bracket.
 *
 * Snapshot rule: called once at Booking-create inside the
 * db.transaction; the result writes to bookings.price_per_participant_*
 * snapshot columns and never recomputes.
 */
export async function resolvePricing(
  db: DBOrTx,
  args: ResolvePricingArgs,
): Promise<ResolvedPricing> {
  const { experienceId, participantCount } = args
  const now = args.now ?? new Date()

  if (!Number.isInteger(participantCount) || participantCount <= 0) {
    throw new Error('participantCount must be a positive integer')
  }

  const [exp] = await db
    .select({
      id: experiences.id,
      vendorUserId: experiences.vendorUserId,
      activitySlug: experiences.activitySlug,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
    })
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!exp) {
    throw new Error(`Experience ${experienceId} not found`)
  }

  // 0. Selected pricing variation — TOP precedence (ADR-0011 revision
  // 2026-06-16, issue #07). When a variationId is supplied it MUST be a valid,
  // ACTIVE variation belonging to this Experience: an unknown / foreign /
  // inactive id is REJECTED (throw) so a Customer who selected a specific
  // priced option never silently pays a different resolved price. The
  // variation's price wins over every lower arm and is snapshotted by the
  // caller. Variations share the slot's capacity — no capacity logic here.
  if (args.variationId !== undefined) {
    const [variation] = await db
      .select({
        id: experiencePricingVariations.id,
        experienceId: experiencePricingVariations.experienceId,
        pricePerPerson: experiencePricingVariations.pricePerPerson,
        isActive: experiencePricingVariations.isActive,
      })
      .from(experiencePricingVariations)
      .where(eq(experiencePricingVariations.id, args.variationId))
      .limit(1)

    if (!variation || variation.experienceId !== experienceId) {
      throw new Error(
        `Pricing variation ${args.variationId} is not valid for experience ${experienceId}`,
      )
    }
    if (!variation.isActive) {
      throw new Error(`Pricing variation ${args.variationId} is not active`)
    }
    return {
      pricePerParticipant: variation.pricePerPerson,
      basis: `pricing_variation:${variation.id}`,
    }
  }

  // 1. Pricing tier override — most recently created matching tier wins.
  const matchingTiers = await db
    .select({
      name: pricingTiers.name,
      pricePerPersonOverride: pricingTiers.pricePerPersonOverride,
    })
    .from(pricingTiers)
    .where(
      and(
        lte(pricingTiers.startAt, now),
        // Use drizzle's `gt` (not a raw `sql` interpolation) so the Date is
        // serialised to the column type. A raw `sql\`... > ${now}\`` passes
        // the JS Date straight to postgres-js, which throws
        // ERR_INVALID_ARG_TYPE ("string argument ... received Date") on the
        // real driver — PGlite tolerates it, so unit tests miss it. This is
        // on the money path (booking-create → resolvePricing). (Issue #13)
        gt(pricingTiers.endAt, now),
        sql`(
          array_length(${pricingTiers.appliesToCategories}, 1) IS NULL
          OR ${exp.activitySlug} = ANY(${pricingTiers.appliesToCategories})
        )`,
        sql`(
          array_length(${pricingTiers.appliesToVendorIds}, 1) IS NULL
          OR ${exp.vendorUserId} = ANY(${pricingTiers.appliesToVendorIds})
        )`,
        sql`(
          array_length(${pricingTiers.appliesToExperienceIds}, 1) IS NULL
          OR ${exp.id}::uuid = ANY(${pricingTiers.appliesToExperienceIds})
        )`,
      ),
    )
    .orderBy(sql`${pricingTiers.createdAt} DESC`)
    .limit(1)

  if (matchingTiers.length) {
    const tier = matchingTiers[0]!
    return {
      pricePerParticipant: tier.pricePerPersonOverride,
      basis: `pricing_tier:${tier.name}`,
    }
  }

  // 2. Slot-specific override — deferred to v1.x per ADR-0011.

  // 3. Group-size bracket on the Experience.
  if (participantCount <= 2) {
    return {
      pricePerParticipant: exp.pricePerPerson_1_2,
      basis: 'experience_bracket:1_2',
    }
  }
  if (participantCount <= 5) {
    return {
      pricePerParticipant: exp.pricePerPerson_3_5,
      basis: 'experience_bracket:3_5',
    }
  }
  return {
    pricePerParticipant: exp.pricePerPerson_6_plus,
    basis: 'experience_bracket:6_plus',
  }
}
