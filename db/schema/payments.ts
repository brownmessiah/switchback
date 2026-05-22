import { sql } from 'drizzle-orm'
import {
  check,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { bookings } from './bookings'

/**
 * Capture trigger per ADR-0001. Each Razorpay capture writes a row
 * here so the audit trail of how the Booking's gross was funded is
 * intrinsic to the schema, not derived from logs.
 *
 *   booking_create        — 25% Advance OR 100% Full
 *   auto_capture_t_minus_24h — 75% second capture on partial-pay
 *   escrow_full_capture   — 100% upfront on Rs.25k+ partial-pay route
 *   manual_admin          — admin-initiated capture (rare)
 *   refund_reverse        — placeholder for the inverse direction;
 *                            negative amount in row
 */
export const captureTriggerEnum = pgEnum('capture_trigger', [
  'booking_create',
  'auto_capture_t_minus_24h',
  'escrow_full_capture',
  'manual_admin',
  'refund_reverse',
])

/**
 * Razorpay capture rows. razorpay_payment_id is unique — the webhook
 * idempotency check (Upstash Redis dedup) backs onto this constraint
 * as a last line of defence against double-capture per ADR-0001.
 *
 * raw_webhook_payload preserves the full Razorpay event body for
 * reconciliation and dispute handling. Treat as PII.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .references(() => bookings.id, { onDelete: 'restrict' })
      .notNull(),
    razorpayPaymentId: text('razorpay_payment_id').notNull().unique(),
    razorpayOrderId: text('razorpay_order_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    captureTrigger: captureTriggerEnum('capture_trigger').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    rawWebhookPayload: jsonb('raw_webhook_payload'),
    ...timestamps,
  },
  (t) => [
    // Refund reverses are negative; everything else is positive.
    check(
      'amount_sign_matches_trigger',
      sql`(${t.captureTrigger} = 'refund_reverse' AND ${t.amount} < 0) OR
          (${t.captureTrigger} <> 'refund_reverse' AND ${t.amount} > 0)`,
    ),
  ],
)

export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
