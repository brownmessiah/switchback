/**
 * Unit test for the Refund Calculator compute helper (#68, Direction B).
 *
 * The interactive hero on /cancellation-policy must NEVER reimplement refund
 * math — it computes its quote through the same pure `quoteRefund` function the
 * money path uses (lib/payments/refund-policy.ts). This test pins the helper to
 * `quoteRefund` for representative cases across all three presets so a drift in
 * the calculator can never silently show a wrong rupee figure to the Customer.
 */
import { describe, expect, it } from 'vitest'

import { quoteRefund } from '@/lib/payments/refund-policy'

import {
  computeRefundQuote,
  type RefundCalcInput,
} from '@/app/[locale]/(marketing)/cancellation-policy/refund-calculator'

/** Build the equivalent quoteRefund args for a "hours before start" input. */
function referenceQuote(input: RefundCalcInput) {
  const startAt = new Date('2026-06-01T00:00:00.000Z')
  const cancellationAt = new Date(
    startAt.getTime() - input.hoursBefore * 3_600_000,
  )
  return quoteRefund({
    preset: input.preset,
    startAt,
    cancellationAt,
    bookingTotalRupees: input.bookingTotalRupees,
  })
}

describe('computeRefundQuote', () => {
  it('Flexible ₹1000 at 48h before start → full ₹1000 (free window)', () => {
    const input: RefundCalcInput = {
      preset: 'flexible',
      bookingTotalRupees: 1000,
      hoursBefore: 48,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(1000)
    expect(result.basis).toBe('free_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Flexible ₹1000 at 12h before start → 50% ₹500 (half window)', () => {
    const input: RefundCalcInput = {
      preset: 'flexible',
      bookingTotalRupees: 1000,
      hoursBefore: 12,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(500)
    expect(result.basis).toBe('50%_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Flexible ₹1000 at 1h before start → ₹0 (no-refund window)', () => {
    const input: RefundCalcInput = {
      preset: 'flexible',
      bookingTotalRupees: 1000,
      hoursBefore: 1,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(0)
    expect(result.basis).toBe('no_refund_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Moderate ₹2000 at 100h before start → full ₹2000 (free window ≥72h)', () => {
    const input: RefundCalcInput = {
      preset: 'moderate',
      bookingTotalRupees: 2000,
      hoursBefore: 100,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(2000)
    expect(result.basis).toBe('free_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Moderate ₹2001 at 48h before start → floored 50% ₹1000 (half window)', () => {
    const input: RefundCalcInput = {
      preset: 'moderate',
      bookingTotalRupees: 2001,
      hoursBefore: 48,
    }
    const result = computeRefundQuote(input)
    // Half of an odd total floors — the remainder lands in the fee.
    expect(result.refundAmountRupees).toBe(1000)
    expect(result.basis).toBe('50%_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Strict ₹5000 at 30 days before start → full ₹5000 (free window ≥14d)', () => {
    const input: RefundCalcInput = {
      preset: 'strict',
      bookingTotalRupees: 5000,
      hoursBefore: 30 * 24,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(5000)
    expect(result.basis).toBe('free_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Strict ₹5000 at 10 days before start → 50% ₹2500 (half window ≥7d)', () => {
    const input: RefundCalcInput = {
      preset: 'strict',
      bookingTotalRupees: 5000,
      hoursBefore: 10 * 24,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(2500)
    expect(result.basis).toBe('50%_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })

  it('Strict ₹5000 at 3 days before start → ₹0 (no-refund window <7d)', () => {
    const input: RefundCalcInput = {
      preset: 'strict',
      bookingTotalRupees: 5000,
      hoursBefore: 3 * 24,
    }
    const result = computeRefundQuote(input)
    expect(result.refundAmountRupees).toBe(0)
    expect(result.basis).toBe('no_refund_window')
    expect(result.refundAmountRupees).toBe(
      referenceQuote(input).refundAmountRupees,
    )
  })
})
