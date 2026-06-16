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

export type CancellationPreset = 'flexible' | 'moderate' | 'strict' | 'non_cancellable' | 'custom'

export type PolicyWindowBasis =
  | 'free_window'
  | '50%_window'
  | 'no_refund_window'
  | 'outside_policy'
  | 'vendor_cancelled'
  // ADR-0005 revision 2026-06-16 (issue #09): a Customer cancellation on a
  // `non_cancellable` Booking. Distinct basis (not 'outside_policy') for audit
  // clarity — always 0 refund, full fee held, routes to Dispute.
  | 'non_cancellable'

export interface RefundQuote {
  refundAmountRupees: number
  cancellationFeeRupees: number
  basis: PolicyWindowBasis
  routesToDispute: boolean
  // ADR-0005 revision 2026-06-16 (issue #09): the Booking's snapshotted
  // reschedule right, echoed back so callers (the cancellation UI /
  // Booking-detail surface, issue #10) read it from the same place as the
  // refund figure. A property carried ALONGSIDE the refund math — never an
  // input to it. Defaults false when not supplied.
  rescheduleAllowed: boolean
}

export interface QuoteRefundArgs {
  preset: CancellationPreset
  startAt: Date
  cancellationAt: Date
  bookingTotalRupees: number
  vendorCancelled?: boolean
  // See RefundQuote.rescheduleAllowed — echoed unchanged onto the quote.
  rescheduleAllowed?: boolean
}

// Hours-to-start thresholds per preset. Boundaries are inclusive of the
// earlier (more favourable to Customer) window — e.g. cancellation at
// exactly T-24h on Flexible is in the free window.
// `non_cancellable` is deliberately ABSENT from this table — it has no window
// math (always 0). `custom` is likewise absent (admin-defined table, throws).
// Exported so the plain-language copy source (lib/payments/cancellation-copy.ts,
// issue #10) DERIVES its hour/day figures from the SAME numbers the refund math
// uses — the rendered policy line can never drift from what is actually refunded.
export const PRESET_WINDOWS: Record<
  Exclude<CancellationPreset, 'custom' | 'non_cancellable'>,
  { freeHours: number; halfHours: number }
> = {
  flexible: { freeHours: 24, halfHours: 2 },
  moderate: { freeHours: 72, halfHours: 24 },
  strict: { freeHours: 14 * 24, halfHours: 7 * 24 },
}

export function quoteRefund(args: QuoteRefundArgs): RefundQuote {
  const {
    preset,
    startAt,
    cancellationAt,
    bookingTotalRupees,
    vendorCancelled = false,
    rescheduleAllowed = false,
  } = args

  if (bookingTotalRupees < 0) {
    throw new Error('bookingTotalRupees must be non-negative')
  }
  if (preset === 'custom') {
    throw new Error(
      'Custom Cancellation policy presets must be resolved through the admin-defined refund table (lib/payments/refund-policy-custom.ts, not yet implemented)',
    )
  }
  // Vendor-cancellation ALWAYS wins first, before the preset is consulted —
  // a Vendor-cancelled non_cancellable Booking is still full-refunded
  // (ADR-0005 invariant, unchanged by the issue #09 revision).
  if (vendorCancelled) {
    return {
      refundAmountRupees: bookingTotalRupees,
      cancellationFeeRupees: 0,
      basis: 'vendor_cancelled',
      routesToDispute: false,
      rescheduleAllowed,
    }
  }
  // ADR-0005 revision 2026-06-16 (issue #09): a Customer cancellation on a
  // `non_cancellable` Booking yields 0 refund in EVERY window — there is no
  // window math, so it is decided here before the windowed-preset table. It
  // behaves like outside-policy (full fee held, routes to Dispute per ADR-0003,
  // where Outvers may still grant an exceptional refund at discretion).
  if (preset === 'non_cancellable') {
    return {
      refundAmountRupees: 0,
      cancellationFeeRupees: bookingTotalRupees,
      basis: 'non_cancellable',
      routesToDispute: true,
      rescheduleAllowed,
    }
  }
  if (cancellationAt >= startAt) {
    return {
      refundAmountRupees: 0,
      cancellationFeeRupees: bookingTotalRupees,
      basis: 'outside_policy',
      routesToDispute: true,
      rescheduleAllowed,
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
      rescheduleAllowed,
    }
  }
  if (hoursToStart >= halfHours) {
    const refund = Math.floor(bookingTotalRupees / 2)
    return {
      refundAmountRupees: refund,
      cancellationFeeRupees: bookingTotalRupees - refund,
      basis: '50%_window',
      routesToDispute: false,
      rescheduleAllowed,
    }
  }
  return {
    refundAmountRupees: 0,
    cancellationFeeRupees: bookingTotalRupees,
    basis: 'no_refund_window',
    routesToDispute: false,
    rescheduleAllowed,
  }
}
