/**
 * ADR-0007 — Vendor verification tier caps (Tier-2 / "Identity verified").
 *
 * A pure, side-effect-free guard. It takes a KYC tier plus the facts of a
 * listing (per-person price, combo flag, and the Availability slots that
 * back it) and decides whether the listing is allowed under that tier.
 *
 * Three tiers (ADR-0007):
 *   - phone:    signup-only. CANNOT publish or accept Bookings.
 *   - identity: Tier-2 caps apply — single-day only, max Rs.5,000
 *               per-person ticket, max 8 participants per slot, NO combo,
 *               NO multi-day.
 *   - business: UNRESTRICTED.
 *
 * The caps are enforced at two points (ADR-0007 "Consequences"):
 *   1. Experience-publish time (vendor create/edit + admin approve).
 *   2. Booking-create time (re-checked because the Vendor's tier may have
 *      been downgraded after the Experience was published).
 *
 * Because the two callers report errors differently (publish returns
 * `{ ok: false, error }`; booking-create throws), this guard *returns* a
 * structured result and lets each caller adapt it.
 */

/** Tier-2 per-person ticket ceiling, in whole rupees (inclusive). */
export const IDENTITY_MAX_PRICE_PER_PERSON_RUPEES = 5000

/** Tier-2 participants-per-slot ceiling (inclusive). */
export const IDENTITY_MAX_PARTICIPANTS_PER_SLOT = 8

export type KycTier = 'phone' | 'identity' | 'business'

/** The facts of a single Availability slot relevant to the Tier-2 caps. */
export interface TierCapSlot {
  startAt: Date
  endAt: Date
  capacity: number
}

export interface TierCapInput {
  kycTier: KycTier
  /**
   * The highest per-person ticket price across the Experience's
   * Group-size brackets (1-2 / 3-5 / 6+), in whole rupees. The cap is on
   * the per-person ticket, so the strictest bracket governs.
   */
  pricePerPersonRupees: number
  isCombo: boolean
  /**
   * The Availability slots backing the listing. May be empty at
   * publish time if no slots have been materialised yet — price and
   * combo are still enforced.
   */
  slots: readonly TierCapSlot[]
}

export type TierCapViolationCode =
  | 'PHONE_CANNOT_PUBLISH'
  | 'PRICE_OVER_CAP'
  | 'CAPACITY_OVER_CAP'
  | 'COMBO_NOT_ALLOWED'
  | 'MULTI_DAY_NOT_ALLOWED'
  | 'EXPERIENCE_NOT_FOUND'

export type TierCapResult =
  | { ok: true }
  | { ok: false; code: TierCapViolationCode; reason: string }

/**
 * Two timestamps fall on the same calendar day (UTC) — the single-day
 * test for the Tier-2 "no multi-day treks" cap. UTC is the storage
 * timezone for slots; the IST boundary approximation is immaterial here
 * (a slot would have to cross local midnight to differ, which is already
 * a multi-day signal).
 */
function isSameCalendarDayUtc(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/**
 * Decide whether a listing is permitted under the Vendor's KYC tier per
 * ADR-0007. Returns the first violation found (deterministic ordering:
 * tier gate → price → combo → per-slot single-day → per-slot capacity).
 */
export function assertWithinTier(input: TierCapInput): TierCapResult {
  // Phone tier cannot publish at all (ADR-0007 Tier 1).
  if (input.kycTier === 'phone') {
    return {
      ok: false,
      code: 'PHONE_CANNOT_PUBLISH',
      reason:
        'Phone-verified Vendors cannot publish Experiences. Complete Identity verification (Aadhaar + PAN) first.',
    }
  }

  // Business tier is unrestricted (ADR-0007 Tier 3).
  if (input.kycTier === 'business') {
    return { ok: true }
  }

  // Identity tier (ADR-0007 Tier 2) — enforce the caps.
  if (input.pricePerPersonRupees > IDENTITY_MAX_PRICE_PER_PERSON_RUPEES) {
    return {
      ok: false,
      code: 'PRICE_OVER_CAP',
      reason: `Identity-verified Vendors may charge up to Rs.${IDENTITY_MAX_PRICE_PER_PERSON_RUPEES} per person; this Experience charges Rs.${input.pricePerPersonRupees}. Upgrade to Business verification to lift the cap.`,
    }
  }

  if (input.isCombo) {
    return {
      ok: false,
      code: 'COMBO_NOT_ALLOWED',
      reason:
        'Identity-verified Vendors cannot publish Combo Experiences. Upgrade to Business verification.',
    }
  }

  for (const slot of input.slots) {
    if (!isSameCalendarDayUtc(slot.startAt, slot.endAt)) {
      return {
        ok: false,
        code: 'MULTI_DAY_NOT_ALLOWED',
        reason:
          'Identity-verified Vendors can only publish single-day Experiences. Upgrade to Business verification for multi-day treks.',
      }
    }
    if (slot.capacity > IDENTITY_MAX_PARTICIPANTS_PER_SLOT) {
      return {
        ok: false,
        code: 'CAPACITY_OVER_CAP',
        reason: `Identity-verified Vendors may host up to ${IDENTITY_MAX_PARTICIPANTS_PER_SLOT} participants per slot; a slot is set to ${slot.capacity}. Upgrade to Business verification to lift the cap.`,
      }
    }
  }

  return { ok: true }
}
