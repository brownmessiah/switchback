import { sql } from 'drizzle-orm'
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { bookings } from './bookings'
import { users } from './users'

/**
 * Refund cause per ADR-0004 (two-balance wallet) + ADR-0005 (cancellation
 * policy presets). Distinct from booking state — a Booking is `disputed`
 * for the duration of admin review; the refund_request that comes out of
 * that review records the resolved reason.
 */
export const refundReasonEnum = pgEnum('refund_reason', [
  'inside_policy_cancellation',
  'outside_policy_dispute_resolved',
  'vendor_cancelled',
  'admin_override',
])

/**
 * Where the refund actually lands. Default per ADR-0004 is refund_balance
 * (24-48h SLA, closed-loop with cashout optionality). original_payment_method
 * is the Customer-requested cashout via Razorpay (5-7 working day round-trip).
 */
export const refundDestinationEnum = pgEnum('refund_destination', [
  'refund_balance',
  'original_payment_method',
])

/**
 * Lifecycle state of the refund_request. Inside-policy auto-credits
 * transition pending → approved → credited in one transaction; outside-
 * policy disputes wait in pending while admin resolves; failed Razorpay
 * cashouts park in failed for ops retry; rejected covers no_refund_window
 * outcomes (row is written even when amount is 0 so the policy
 * snapshot is traceable).
 */
export const refundRequestStateEnum = pgEnum('refund_request_state', [
  'pending',
  'approved',
  'credited',
  'failed',
  'rejected',
])

/**
 * Refund record per ADR-0004 / ADR-0005. Snapshots the Cancellation
 * policy preset that justified this refund + the basis label
 * (`free_window`, `50%_window`, `no_refund_window`, `vendor_cancelled`,
 * `admin_override`) so a future audit can verify the refund math
 * without reading code that may have evolved.
 *
 * FK semantics:
 *  - booking_id → ON DELETE RESTRICT. Live refund_requests block booking
 *    archival; admin must reverse the refund first.
 *  - requested_by_user_id → ON DELETE RESTRICT. Customers with refund
 *    history cannot be hard-deleted.
 *  - payments.refund_request_id (defined in payments.ts) is the inverse
 *    edge — every refund_reverse payment row points back to a
 *    refund_requests row (enforced by CHECK in payments.ts).
 */
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'restrict' })
      .notNull(),
    requestedByUserId: text('requested_by_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    reason: refundReasonEnum('reason').notNull(),
    destination: refundDestinationEnum('destination').notNull(),
    state: refundRequestStateEnum('state').default('pending').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    // Snapshot the policy values that justified this refund.
    cancellationPresetSnapshot: text('cancellation_preset_snapshot').notNull(),
    policyWindowBasisSnapshot: text('policy_window_basis_snapshot').notNull(),
    notes: text('notes'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    check('non_negative_refund_amount', sql`${t.amount} >= 0`),
    // Snapshot enums stored as text for forward compat; CHECK enforces the
    // closed set of legal values so a typo cannot silently corrupt the
    // audit trail that backs a tax-authority dispute.
    check(
      'valid_cancellation_preset_snapshot',
      sql`${t.cancellationPresetSnapshot} IN ('flexible','moderate','strict','custom')`,
    ),
    check(
      'valid_policy_window_basis_snapshot',
      sql`${t.policyWindowBasisSnapshot} IN
          ('free_window','50%_window','no_refund_window','vendor_cancelled','admin_override','outside_policy')`,
    ),
    // Block the double-refund race. Two concurrent inside-policy
    // cancellations on the same Booking cannot both INSERT an active
    // refund_request — second INSERT raises on this partial unique.
    // rejected/failed rows are excluded so a Customer can retry after a
    // Razorpay failure or admin denial.
    uniqueIndex('one_active_refund_per_booking')
      .on(t.bookingId)
      .where(sql`state NOT IN ('rejected', 'failed')`),
    index('refund_requests_by_booking').on(t.bookingId),
    index('refund_requests_by_state').on(t.state),
    index('refund_requests_by_time').on(t.createdAt),
  ],
)

export type RefundRequest = typeof refundRequests.$inferSelect
export type NewRefundRequest = typeof refundRequests.$inferInsert
