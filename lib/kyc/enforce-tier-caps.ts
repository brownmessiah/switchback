import { eq } from 'drizzle-orm'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import {
  assertWithinTier,
  type KycTier,
  type TierCapResult,
  type TierCapSlot,
} from './tier-caps'

/**
 * ADR-0007 — DB-aware wiring for the pure Tier-2 cap guard.
 *
 * The pure guard (`assertWithinTier`) is fact-based and side-effect-free.
 * These helpers load the facts (Vendor tier, Experience price/combo, and
 * the relevant Availability slots) and run the guard. They are the single
 * source the publish path and booking-create both call so the cap logic
 * stays in one place.
 */

/**
 * The highest per-person ticket price across the Experience's Group-size
 * brackets, in whole rupees. The Tier-2 cap is on the per-person ticket,
 * so the strictest (highest) bracket governs.
 */
function maxPricePerPersonRupees(exp: {
  pricePerPerson_1_2: string
  pricePerPerson_3_5: string
  pricePerPerson_6_plus: string
}): number {
  return Math.max(
    Number(exp.pricePerPerson_1_2),
    Number(exp.pricePerPerson_3_5),
    Number(exp.pricePerPerson_6_plus),
  )
}

interface ExperienceTierFacts {
  kycTier: KycTier
  pricePerPersonRupees: number
  isCombo: boolean
}

/**
 * Load the Vendor tier + Experience price/combo facts for an Experience.
 * Returns null when the Experience (or its Vendor) does not exist.
 */
async function loadExperienceFacts(
  db: DBOrTx,
  experienceId: string,
): Promise<ExperienceTierFacts | null> {
  const [row] = await db
    .select({
      kycTier: vendorProfiles.kycTier,
      isCombo: experiences.isCombo,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!row) return null

  return {
    kycTier: row.kycTier as KycTier,
    pricePerPersonRupees: maxPricePerPersonRupees(row),
    isCombo: row.isCombo,
  }
}

/**
 * Publish-time check: assert an Experience is within its Vendor's KYC tier
 * caps, considering ALL of its materialised Availability slots. Returns the
 * pure guard's structured result. Callers adapt it to their error shape.
 *
 * Returns a synthetic violation if the Experience cannot be found, so a
 * missing row never silently publishes.
 */
export async function assertExperienceWithinTier(
  db: DBOrTx,
  experienceId: string,
): Promise<TierCapResult> {
  const facts = await loadExperienceFacts(db, experienceId)
  if (!facts) {
    return {
      ok: false,
      code: 'EXPERIENCE_NOT_FOUND',
      reason: 'Experience not found for tier-cap check.',
    }
  }

  const slots = await db
    .select({
      startAt: availabilitySlots.startAt,
      endAt: availabilitySlots.endAt,
      capacity: availabilitySlots.capacity,
    })
    .from(availabilitySlots)
    .where(eq(availabilitySlots.experienceId, experienceId))

  return assertWithinTier({
    kycTier: facts.kycTier,
    pricePerPersonRupees: facts.pricePerPersonRupees,
    isCombo: facts.isCombo,
    slots: slots satisfies TierCapSlot[],
  })
}

/**
 * Booking-create re-check (ADR-0007): assert an Experience + the SPECIFIC
 * slot being booked are within the Vendor's CURRENT KYC tier caps. Used
 * because the tier may have been downgraded after the Experience was
 * published. Runs inside the booking transaction.
 */
export async function assertBookingWithinTier(
  db: DBOrTx,
  experienceId: string,
  slot: TierCapSlot,
): Promise<TierCapResult> {
  const facts = await loadExperienceFacts(db, experienceId)
  if (!facts) {
    return {
      ok: false,
      code: 'EXPERIENCE_NOT_FOUND',
      reason: 'Experience not found for tier-cap check.',
    }
  }

  return assertWithinTier({
    kycTier: facts.kycTier,
    pricePerPersonRupees: facts.pricePerPersonRupees,
    isCombo: facts.isCombo,
    slots: [slot],
  })
}
