/**
 * Pure retry policy for failed Payout Batches per ADR-0016 (2026-06-18
 * amendment, D5 + "Payout failures"): "3 retries with exponential backoff,
 * then admin queue + Vendor notification."
 *
 * RETRY-COUNT CONTRACT (orchestrator-locked — resolves the issue's two-bullet
 * ambiguity): `failureCount` is the number of FAILED attempts so far, INCLUDING
 * the current one.
 *   1 → retry (backoff b1)
 *   2 → retry (backoff b2 > b1)
 *   3 → retry (backoff b3 > b2)
 *   ≥4 → admin_queue
 *
 * The money-critical invariant is BOUNDED retries (max 3) then admin queue. The
 * actual retry SPACING is provided by the daily 5pm-IST cron cadence + the
 * (vendor, destination, batch_day) unique index — a re-queued group naturally
 * retries on the NEXT day's run. `backoffMs` is an advisory, monotonically
 * growing hint; precise day-level backoff enforcement is out of scope here.
 *
 * PURE — no I/O, no clock, no Razorpay.
 */

/** The maximum number of failed attempts we retry before routing to admin. */
export const MAX_PAYOUT_RETRY_ATTEMPTS = 3

/** Base unit (ms) for the advisory exponential backoff hint. */
const BACKOFF_BASE_MS = 60_000

export type PayoutRetryDecision =
  | { readonly action: 'retry'; readonly backoffMs: number }
  | { readonly action: 'admin_queue' }

export interface DecidePayoutRetryArgs {
  /** Number of FAILED attempts so far, INCLUDING the current failure. */
  readonly failureCount: number
}

/**
 * Decide what to do after a Payout Batch failure.
 *
 * Returns `retry` (with a growing advisory backoff) for the first three
 * failures, and `admin_queue` once retries are exhausted (failureCount ≥ 4).
 */
export function decidePayoutRetry(args: DecidePayoutRetryArgs): PayoutRetryDecision {
  const { failureCount } = args

  if (failureCount > MAX_PAYOUT_RETRY_ATTEMPTS) {
    return { action: 'admin_queue' }
  }

  // Exponential growth: b_n = BASE * 2^(n-1) → 60s, 120s, 240s.
  const backoffMs = BACKOFF_BASE_MS * 2 ** (failureCount - 1)
  return { action: 'retry', backoffMs }
}
