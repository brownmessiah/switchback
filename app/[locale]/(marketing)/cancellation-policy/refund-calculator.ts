/**
 * Pure compute wrapper for the public Refund Calculator hero (#68, Direction B).
 *
 * The calculator is a trust artefact: the rupee figure it shows a Customer
 * BEFORE they ever sign in must be exactly what the money path would refund.
 * So this helper does NOT reimplement any refund math — it translates the
 * calculator's "hours before the Experience start" input into the (startAt,
 * cancellationAt) pair that `quoteRefund` (lib/payments/refund-policy.ts, the
 * single source of truth per ADR-0005) expects, and delegates. A 1-line bug
 * here would only ever surface a stale figure; the canonical math stays in one
 * place.
 *
 * Kept framework-free (no React, no DOM) so it is unit-testable without a
 * browser and importable by the `'use client'` island unchanged.
 */
import {
  quoteRefund,
  type CancellationPreset,
  type RefundQuote,
} from '@/lib/payments/refund-policy'

export type CalculablePreset = Exclude<CancellationPreset, 'custom'>

export interface RefundCalcInput {
  readonly preset: CalculablePreset
  /** Booking total in integer rupees (the money path is rupee-integer). */
  readonly bookingTotalRupees: number
  /** Whole hours between cancellation and the Experience start (start − cancel). */
  readonly hoursBefore: number
}

/** A stable epoch so the (startAt, cancellationAt) pair is deterministic. */
const REFERENCE_START_MS = Date.UTC(2026, 5, 1, 0, 0, 0)

/**
 * Compute the live refund quote for the calculator, delegating entirely to the
 * money-path `quoteRefund`. Returns the canonical `RefundQuote` shape.
 */
export function computeRefundQuote(input: RefundCalcInput): RefundQuote {
  const startAt = new Date(REFERENCE_START_MS)
  const cancellationAt = new Date(
    REFERENCE_START_MS - input.hoursBefore * 3_600_000,
  )

  return quoteRefund({
    preset: input.preset,
    startAt,
    cancellationAt,
    bookingTotalRupees: input.bookingTotalRupees,
  })
}
