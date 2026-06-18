import {
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Payout Batch lifecycle per ADR-0016 (2026-06-18 amendment, D1+D3).
 *
 *   processing → default; the Razorpay X transfer has been requested
 *   paid       → transfer reached the Vendor (terminal, webhook-driven — slice 06)
 *   failed     → transfer failed (slice 07 retries)
 *   reversed   → a previously-paid transfer was reversed (slice 07)
 *
 * Deliberately SEPARATE from the per-Booking `payout_state` enum: the Booking's
 * payout_state is the approval flow (pending/approved/rejected/held); this is
 * the send lifecycle of the AGGREGATE transfer.
 */
export const payoutBatchStatusEnum = pgEnum('payout_batch_status', [
  'processing',
  'paid',
  'failed',
  'reversed',
])

/**
 * The Payout Batch aggregate per ADR-0016 (2026-06-18 amendment, D1+D3).
 *
 * Domain language (CONTEXT.md): a **Payout Batch** is the unit sent to Razorpay
 * X — ONE transfer per (Vendor, destination) per daily 5pm-IST batch. Member
 * Bookings link back via `bookings.payout_batch_id`. This table IS the Payout
 * Batch aggregate (the per-Booking **Payout** lives on the bookings row).
 *
 * At-most-once guard: the unique index on
 * (vendor_user_id, destination_fingerprint, batch_day) makes a double-INSERT a
 * no-op (the cron uses onConflictDoNothing), and the Razorpay X
 * `X-Payout-Idempotency` header keyed on this row's id (= reference_id) makes a
 * double createPayout call safe. Together: at most one transfer per group.
 *
 * Money invariant: amount_net_rupees = Σ member net; commission + GST + TDS +
 * TCS are RETAINED in the platform balance and never transferred. tds_total /
 * tcs_total carry the summed deductions for the 26Q / GSTR-8 trail.
 *
 * FK semantics:
 *  - vendor_user_id → ON DELETE RESTRICT. A Vendor with Payout Batch history
 *    cannot be hard-deleted.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorUserId: text('vendor_user_id')
      .references(() => users.id, { onDelete: 'restrict' })
      .notNull(),
    /** Shared, shape-stable hash of the destination (lib/payments/payout-destination.ts). */
    destinationFingerprint: text('destination_fingerprint').notNull(),
    /** The Razorpay X Fund Account the resolver matched for this destination. */
    razorpayFundAccountId: text('razorpay_fund_account_id').notNull(),
    /** IST calendar day, 'YYYY-MM-DD', the 5pm-IST cron derives from `now`. */
    batchDay: text('batch_day').notNull(),
    status: payoutBatchStatusEnum('status').default('processing').notNull(),
    /** Σ member net — the exact rupee amount the single transfer carries. */
    amountNetRupees: numeric('amount_net_rupees', { precision: 14, scale: 2 }).notNull(),
    /** Σ member TDS — tracked for 26Q; RETAINED, not transferred. */
    tdsTotal: numeric('tds_total', { precision: 14, scale: 2 }).notNull(),
    /** Σ member TCS — tracked for GSTR-8; RETAINED, not transferred. */
    tcsTotal: numeric('tcs_total', { precision: 14, scale: 2 }).notNull(),
    /** Razorpay X payout id — null until the transfer is sent. */
    razorpayPayoutId: text('razorpay_payout_id'),
    /** Populated on a failed transfer (slice 07). */
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').default(0).notNull(),
    ...timestamps,
  },
  (t) => [
    // THE at-most-once guard: one Payout Batch per (vendor, destination, day).
    uniqueIndex('payouts_vendor_destination_batchday').on(
      t.vendorUserId,
      t.destinationFingerprint,
      t.batchDay,
    ),
    index('payouts_by_status').on(t.status),
    index('payouts_by_vendor').on(t.vendorUserId),
  ],
)

export type Payout = typeof payouts.$inferSelect
export type NewPayout = typeof payouts.$inferInsert
