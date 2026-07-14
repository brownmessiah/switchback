import { sql } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
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
import { orders } from './orders'
import { refundRequests } from './refund-requests'

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
    // Nullable since issue 12 (ADR-0021): a payment is booking-scoped
    // (legacy single-item) XOR order-scoped (cart) — see
    // payment_scope_exactly_one below.
    bookingId: uuid('booking_id').references(() => bookings.id, {
      onDelete: 'restrict',
    }),
    orderId: uuid('order_id').references(() => orders.id, {
      onDelete: 'restrict',
    }),
    razorpayPaymentId: text('razorpay_payment_id').notNull().unique(),
    razorpayOrderId: text('razorpay_order_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    captureTrigger: captureTriggerEnum('capture_trigger').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    rawWebhookPayload: jsonb('raw_webhook_payload'),
    // Refund-cause traceability per ADR-0004 / ADR-0005. Every refund_reverse
    // capture must point back to the refund_requests row that authorised it
    // (enforced by the refund_reverse_requires_request CHECK below). Non-refund
    // captures leave this NULL.
    refundRequestId: uuid('refund_request_id').references(() => refundRequests.id, {
      onDelete: 'restrict',
    }),
    ...timestamps,
  },
  (t) => [
    // Refund reverses are negative; everything else is positive.
    check(
      'amount_sign_matches_trigger',
      sql`(${t.captureTrigger} = 'refund_reverse' AND ${t.amount} < 0) OR
          (${t.captureTrigger} <> 'refund_reverse' AND ${t.amount} > 0)`,
    ),
    // Refund-cause traceability: refund_reverse rows must point at a
    // refund_requests row; non-refund rows leave refund_request_id NULL.
    check(
      'refund_reverse_requires_request',
      sql`(${t.captureTrigger} <> 'refund_reverse') OR (${t.refundRequestId} IS NOT NULL)`,
    ),
    // Webhook idempotency floor for `order.paid` events — Razorpay can
    // fire these before individual payment IDs are assigned. Partial
    // unique allows NULL values for capture rows that pre-date the order.
    uniqueIndex('payments_razorpay_order_id_unique')
      .on(t.razorpayOrderId)
      .where(sql`${t.razorpayOrderId} IS NOT NULL`),
    index('payments_by_booking').on(t.bookingId),
    index('payments_by_order').on(t.orderId),
    // Exactly one scope: booking-scoped (single-item) XOR order-scoped (cart).
    check(
      'payment_scope_exactly_one',
      sql`(${t.bookingId} IS NOT NULL AND ${t.orderId} IS NULL) OR
          (${t.bookingId} IS NULL AND ${t.orderId} IS NOT NULL)`,
    ),
  ],
)

export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
