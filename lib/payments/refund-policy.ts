/**
 * Pure refund-policy quoting per ADR-0005. Load-bearing: a 1-line bug
 * here translates directly to rupees lost. All inputs are validated;
 * Custom presets are explicitly rejected (must be resolved through a
 * separate admin-pre-defined refund table that hasn't shipped yet);
 * cancellation at or after start_at is outside-policy and routes to the
 * Dispute queue (ADR-0003).
 *
 * Money is in integer rupees. Half-rupee refunds are floored — the
 * remainder lands in the cancellation fee. This matches what the legacy
 * Convex codebase did and what the GST + TDS calculators expect.
 */

export type CancellationPreset = 'flexible' | 'moderate' | 'strict' | 'custom'

export type PolicyWindowBasis =
  | 'free_window'
  | '50%_window'
  | 'no_refund_window'
  | 'outside_policy'
  | 'vendor_cancelled'

export interface RefundQuote {
  refundAmountRupees: number
  cancellationFeeRupees: number
  basis: PolicyWindowBasis
  routesToDispute: boolean
}

export interface QuoteRefundArgs {
  preset: CancellationPreset
  startAt: Date
  cancellationAt: Date
  bookingTotalRupees: number
  vendorCancelled?: boolean
}

// Hours-to-start thresholds per preset. Boundaries are inclusive of the
// earlier (more favourable to Customer) window — e.g. cancellation at
// exactly T-24h on Flexible is in the free window.
const PRESET_WINDOWS: Record<Exclude<CancellationPreset, 'custom'>, { freeHours: number; halfHours: number }> = {
  flexible: { freeHours: 24, halfHours: 2 },
  moderate: { freeHours: 72, halfHours: 24 },
  strict: { freeHours: 14 * 24, halfHours: 7 * 24 },
}

export function quoteRefund(args: QuoteRefundArgs): RefundQuote {
  const { preset, startAt, cancellationAt, bookingTotalRupees, vendorCancelled = false } = args

  if (bookingTotalRupees < 0) {
    throw new Error('bookingTotalRupees must be non-negative')
  }
  if (preset === 'custom') {
    throw new Error(
      'Custom Cancellation policy presets must be resolved through the admin-defined refund table (lib/payments/refund-policy-custom.ts, not yet implemented)',
    )
  }
  if (vendorCancelled) {
    return {
      refundAmountRupees: bookingTotalRupees,
      cancellationFeeRupees: 0,
      basis: 'vendor_cancelled',
      routesToDispute: false,
    }
  }
  if (cancellationAt >= startAt) {
    return {
      refundAmountRupees: 0,
      cancellationFeeRupees: bookingTotalRupees,
      basis: 'outside_policy',
      routesToDispute: true,
    }
  }

  const hoursToStart = (startAt.getTime() - cancellationAt.getTime()) / 3_600_000
  const { freeHours, halfHours } = PRESET_WINDOWS[preset]

  if (hoursToStart >= freeHours) {
    return {
      refundAmountRupees: bookingTotalRupees,
      cancellationFeeRupees: 0,
      basis: 'free_window',
      routesToDispute: false,
    }
  }
  if (hoursToStart >= halfHours) {
    const refund = Math.floor(bookingTotalRupees / 2)
    return {
      refundAmountRupees: refund,
      cancellationFeeRupees: bookingTotalRupees - refund,
      basis: '50%_window',
      routesToDispute: false,
    }
  }
  return {
    refundAmountRupees: 0,
    cancellationFeeRupees: bookingTotalRupees,
    basis: 'no_refund_window',
    routesToDispute: false,
  }
}
