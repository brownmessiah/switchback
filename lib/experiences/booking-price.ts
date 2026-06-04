/**
 * Pure Group-size-bracket pricing math for the PDP Booking rail (ADR-0011 +
 * ADR-0001). The bracket fires by participant count — 1-2 / 3-5 / 6+ — and the
 * Partial-pay Advance is 25% of the total (floored, matching the money-path
 * convention in lib/payments/partial-pay-autocapture.ts); the balance is the
 * remainder, captured at T-24h. Mirrors lib/payments/pricing-resolver bracket
 * selection so the rail preview agrees with the server-snapshotted price.
 *
 * This is the client-safe preview only — the authoritative price is resolved +
 * snapshotted server-side at Booking-create. Kept pure so it is unit-tested and
 * shared by the Booking-rail client island.
 */

/** Per-person whole-rupee prices for the three mandatory Group-size brackets. */
export interface BracketPrices {
  /** 1-2 participants. */
  p12: number
  /** 3-5 participants. */
  p35: number
  /** 6+ participants. */
  p6: number
}

export type BracketKey = '1_2' | '3_5' | '6_plus'

/** Default Partial-pay Advance share (ADR-0001). */
export const ADVANCE_RATE = 0.25

/** The Group-size bracket a participant count falls into (ADR-0011). */
export function bracketKeyFor(count: number): BracketKey {
  if (count <= 2) return '1_2'
  if (count <= 5) return '3_5'
  return '6_plus'
}

export interface BookingPrice {
  bracket: BracketKey
  /** Per-person price for the selected bracket, whole rupees. */
  perPerson: number
  /** perPerson × participantCount, whole rupees. */
  total: number
  /** 25% Advance captured now (floored). */
  advanceRupees: number
  /** Remainder captured at T-24h (total − advance). */
  balanceRupees: number
}

/**
 * Resolve the bracket price for `count` participants and split it into the
 * Partial-pay Advance/balance. `count` is clamped to ≥1.
 */
export function computeBookingPrice(
  count: number,
  prices: BracketPrices,
  advanceRate: number = ADVANCE_RATE,
): BookingPrice {
  const c = Math.max(1, Math.floor(count))
  const bracket = bracketKeyFor(c)
  const perPerson =
    bracket === '1_2' ? prices.p12 : bracket === '3_5' ? prices.p35 : prices.p6
  const total = perPerson * c
  const advanceRupees = Math.floor(total * advanceRate)
  const balanceRupees = total - advanceRupees
  return { bracket, perPerson, total, advanceRupees, balanceRupees }
}
