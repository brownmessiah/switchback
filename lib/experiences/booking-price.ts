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

/** ADR-0001 carve-out: a slot starting inside this window skips partial-pay. */
export const PARTIAL_PAY_UNDER_HOURS = 48

/** ADR-0001 carve-out: a ticket above this value defaults to 100% escrow capture. */
export const PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES = 25_000

export interface DisplaySplitArgs {
  /** Selected total in whole rupees. */
  total: number
  /** Whether the Experience allows partial pay at all. */
  allowsPartialPay: boolean
  /**
   * Hours from now until the selected slot's start, or `null` when no date is
   * chosen yet. Drives the ADR-0001 <48h carve-out.
   */
  hoursToStart: number | null
}

export interface DisplaySplit {
  /** True when the whole amount is captured now (no Advance/balance split). */
  fullUpfront: boolean
  /** Captured now — the 25% Advance, or the full total under a carve-out. */
  advanceRupees: number
  /** Captured at T-24h — 0 under a full-upfront carve-out. */
  balanceRupees: number
}

/**
 * DISPLAY-ONLY payment-split preview for the Booking rail (issue 13). Mirrors
 * the ADR-0001 carve-outs that `lib/payments/booking-create` applies
 * server-side so the rail's transparency block never promises a 25% Advance
 * the money path would coerce to 100%:
 *
 *   - Experience disallows partial pay → 100% upfront.
 *   - Slot starts <48h away → 100% upfront (partial-pay UX value is gone).
 *   - Total > Rs.25,000 → 100% upfront (escrow-flavoured capture).
 *   - Otherwise → 25% Advance now, 75% balance at T-24h.
 *
 * This NEVER changes capture logic — the authoritative split is re-derived at
 * Booking-create against the real slot. When no date is chosen (`hoursToStart`
 * is `null`) the standard 25% preview is shown (a date is mandatory before
 * checkout); only the <48h and escrow carve-outs force full-upfront.
 */
export function resolveDisplaySplit({
  total,
  allowsPartialPay,
  hoursToStart,
}: DisplaySplitArgs): DisplaySplit {
  const underWindow = hoursToStart !== null && hoursToStart < PARTIAL_PAY_UNDER_HOURS
  const overEscrow = total > PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES
  const fullUpfront = !allowsPartialPay || underWindow || overEscrow

  if (fullUpfront) {
    return { fullUpfront: true, advanceRupees: total, balanceRupees: 0 }
  }
  const advanceRupees = Math.floor(total * ADVANCE_RATE)
  return { fullUpfront: false, advanceRupees, balanceRupees: total - advanceRupees }
}
