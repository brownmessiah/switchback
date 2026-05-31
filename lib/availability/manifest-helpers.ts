/**
 * Pure helpers for the Vendor availability cockpit (#78, DESIGN.md variant A).
 *
 * These compute the in-grid semantic status and the Partial-pay balance-due
 * figure from the REAL slot / Booking facts already loaded by the page. No
 * fabrication, no money-write — read-only derivation only.
 */

/** Persisted slot status (db/schema/availability-slots → slot_status enum). */
export type PersistedSlotStatus = 'open' | 'sold_out' | 'closed'

/** Derived, display-facing status for the calendar grid + day Sheet. */
export type DerivedSlotStatus = 'open' | 'likely-sell-out' | 'sold-out' | 'closed'

export interface SlotStatusInput {
  capacity: number
  capacityTaken: number
  status: PersistedSlotStatus
}

/**
 * Threshold below which an in-demand slot is flagged "likely to sell out":
 * remaining seats ≤ ceil(20% of capacity) AND at least one seat already taken.
 * A slot that is merely small but unbooked is NOT urgency — only demand is.
 */
const LIKELY_SELL_OUT_RATIO = 0.2

/**
 * Classify a slot into one of the four display buckets. A Region closure
 * (ADR-0011) or a blocked (`closed`) slot always reads as `closed`, taking
 * precedence over capacity-derived states.
 */
export function classifySlotStatus(
  slot: SlotStatusInput,
  hasClosure: boolean,
): DerivedSlotStatus {
  if (hasClosure || slot.status === 'closed') return 'closed'
  if (slot.capacityTaken >= slot.capacity) return 'sold-out'

  const remaining = slot.capacity - slot.capacityTaken
  const nearThreshold = Math.ceil(slot.capacity * LIKELY_SELL_OUT_RATIO)
  if (slot.capacityTaken > 0 && remaining <= nearThreshold) return 'likely-sell-out'

  return 'open'
}

/** Fraction of gross captured up front as the Advance (ADR-0001). */
const ADVANCE_FRACTION = 0.25

/**
 * The Partial-pay balance due at T-24h, in whole rupees. Canonical convention
 * (mirrors lib/payments/partial-pay-autocapture): the advance is the
 * floor-rounded 25% and the balance carries the remainder, so
 * `advance + balance === gross` for every rupee gross.
 */
export function computeBalanceDueRupees(grossRupees: number): number {
  const advance = Math.floor(grossRupees * ADVANCE_FRACTION)
  return grossRupees - advance
}

/** Group-size bracket label fired by participant count (ADR-0011: 1-2 / 3-5 / 6+). */
export function bracketLabel(participantCount: number): '1-2' | '3-5' | '6+' {
  if (participantCount <= 2) return '1-2'
  if (participantCount <= 5) return '3-5'
  return '6+'
}
