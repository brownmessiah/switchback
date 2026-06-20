import { payoutWindowDays } from './payout-calculator'
import type { ResolveFundAccountResult } from './fund-account-resolver'

/**
 * Pure classifier for the admin payout queue per slice 05 (PRD stories 11 + 14)
 * and ADR-0016 (first-3 manual gate; admin-queue visibility).
 *
 * The admin payouts page renders one of these categories per Payout so nothing
 * silently disappears: the first-3 queue MUST be visible (story 11), and a
 * Payout whose Fund Account is missing or still cooling off MUST surface as an
 * exception rather than being dropped (story 14, the slice-04 amendment).
 *
 * PURE — no I/O, no clock, no Razorpay. The caller injects `now` and, for
 * matured-eligible-unbatched Payouts, the pre-resolved Fund Account status
 * (reusing slice-04's `resolveFundAccount` + `destinationFingerprint`). Maturity
 * reuses slice-04's `payoutWindowDays` so the queue and the cron agree exactly.
 */

export type PayoutQueueCategory =
  | 'not_matured'
  | 'awaiting_approval'
  | 'auto_pending'
  | 'blocked_fund_account'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'reversed'
  | 'rejected'
  | 'held'

/** Every category the queue can render (drives grouping + an exhaustive map). */
export const PAYOUT_QUEUE_CATEGORIES = [
  'awaiting_approval',
  'blocked_fund_account',
  'auto_pending',
  'not_matured',
  'processing',
  'paid',
  'failed',
  'reversed',
  'held',
  'rejected',
] as const satisfies readonly PayoutQueueCategory[]

const PAYOUT_QUEUE_CATEGORY_LABEL: Record<PayoutQueueCategory, string> = {
  awaiting_approval: 'Awaiting approval',
  blocked_fund_account: 'Fund account blocked',
  auto_pending: 'Queued for batch',
  not_matured: 'Maturing',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
  reversed: 'Reversed',
  held: 'Held',
  rejected: 'Rejected',
}

/** Human label for a queue category (admin-facing). */
export function payoutQueueCategoryLabel(category: PayoutQueueCategory): string {
  return PAYOUT_QUEUE_CATEGORY_LABEL[category]
}

/** The full bookings.payout_state enum (db/schema/bookings.ts). */
export type PayoutState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'held'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'reversed'

export interface PayoutQueueItemInput {
  payoutState: PayoutState
  /** bookings.completed_at — null until the Booking completes. */
  completedAt: Date | null
  /** experiences.required_permits non-empty → extended T+30 window. */
  permitRequired: boolean
  /** booked slot spans >1 calendar day → extended T+30 window. */
  multiDay: boolean
  /** vendor_profiles.manual_payouts_remaining (READ-only — drives the first-3 gate). */
  manualPayoutsRemaining: number
  /** bookings.payout_batch_id IS NOT NULL — the Payout has been sent in a Batch. */
  alreadyBatched: boolean
  /**
   * Fund Account resolution for matured-eligible-unbatched Payouts (slice-04's
   * resolveFundAccount). The caller resolves it only when relevant; for the
   * other categories any value is ignored.
   */
  fundAccount: ResolveFundAccountResult
  now: Date
}

const MS_PER_DAY = 86_400_000

function isMatured(input: PayoutQueueItemInput): boolean {
  if (input.completedAt === null) return false
  const windowDays = payoutWindowDays({
    permitRequired: input.permitRequired,
    multiDay: input.multiDay,
  })
  const maturesAt = input.completedAt.getTime() + windowDays * MS_PER_DAY
  return maturesAt <= input.now.getTime()
}

export function classifyPayoutQueueItem(input: PayoutQueueItemInput): PayoutQueueCategory {
  // The Payout Batch send lifecycle shows its send status straight through.
  if (input.payoutState === 'processing') return 'processing'
  if (input.payoutState === 'paid') return 'paid'
  if (input.payoutState === 'failed') return 'failed'
  if (input.payoutState === 'reversed') return 'reversed'

  // Defensive: a batched Booking whose payout_state still lags behind the linked
  // Batch (pending/approved) has nonetheless been sent — surface it as processing
  // so it never reappears in the actionable queue.
  if (input.alreadyBatched) return 'processing'

  // Frozen / terminal admin decisions — visible regardless of maturity.
  if (input.payoutState === 'held') return 'held'
  if (input.payoutState === 'rejected') return 'rejected'

  // From here payoutState is 'pending' or 'approved' and unbatched.
  if (!isMatured(input)) return 'not_matured'

  // Matured + pending + the Vendor still has manual approvals → the first-3 queue.
  if (input.payoutState === 'pending' && input.manualPayoutsRemaining > 0) {
    return 'awaiting_approval'
  }

  // Matured + eligible (approved, OR pending with the gate open) → it will batch
  // on the next cron run UNLESS the Fund Account isn't resolvable yet.
  if (input.fundAccount.status === 'admin_queue') return 'blocked_fund_account'
  return 'auto_pending'
}
