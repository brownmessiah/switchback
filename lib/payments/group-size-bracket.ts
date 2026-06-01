/**
 * Group-size price bracket resolution for the booking flow (ADR-0011).
 *
 * The per-person price depends on the participant count: 1-2, 3-5, or 6+.
 * This is the **display-side** helper shared by the checkout page (server)
 * and the participant-count stepper (client) so the live quote on the form
 * matches the server render exactly.
 *
 * SNAPSHOT RULE (ADR-0008/0011): this is NOT the authoritative price.
 * `createBooking` (lib/payments/booking-create + pricing-resolver) re-resolves
 * the bracket from the submitted `participantCount` inside the create
 * transaction and snapshots it onto the Booking — the client never sends a
 * price. This helper only drives the on-screen quote.
 */

export type GroupSizeBracketBasis = 'tier_1_2' | 'tier_3_5' | 'tier_6_plus'

export interface BracketPrices {
  /** pricePerPerson_1_2 */
  tier12: number
  /** pricePerPerson_3_5 */
  tier35: number
  /** pricePerPerson_6_plus */
  tier6: number
}

export function groupSizeBracketPrice(
  prices: BracketPrices,
  count: number,
): { pricePerPerson: number; basis: GroupSizeBracketBasis } {
  if (count <= 2) return { pricePerPerson: prices.tier12, basis: 'tier_1_2' }
  if (count <= 5) return { pricePerPerson: prices.tier35, basis: 'tier_3_5' }
  return { pricePerPerson: prices.tier6, basis: 'tier_6_plus' }
}

export interface CheckoutQuote {
  pricePerPerson: number
  basis: GroupSizeBracketBasis
  gross: number
  /** Amount charged now: the 25% advance under partial-pay, else the full gross. */
  advance: number
  /** Auto-captured T-24h under partial-pay (0 under full-upfront). */
  balance: number
}

/**
 * Live checkout quote for a participant count. The partial-pay advance is
 * floor(25% of gross) — the same rounding the order summary + the T-24h
 * auto-capture use, so advance + balance === gross exactly.
 */
export function quoteCheckout(
  prices: BracketPrices,
  count: number,
  supportsPartialPay: boolean,
): CheckoutQuote {
  const { pricePerPerson, basis } = groupSizeBracketPrice(prices, count)
  const gross = pricePerPerson * count
  const advance = supportsPartialPay ? Math.floor(gross * 0.25) : gross
  return { pricePerPerson, basis, gross, advance, balance: gross - advance }
}
