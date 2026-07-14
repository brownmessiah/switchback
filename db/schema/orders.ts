import { numeric, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Checkout order envelope (home-redesign issue 12, ADR-0021).
 *
 * ONE order groups the N independent Bookings a cart checkout creates and
 * carries the single order-scoped Razorpay payment (`razorpay_order_id`,
 * set AFTER the outer transaction commits — the external call never runs
 * inside the DB transaction). `amount_total_snapshot` is the summed
 * per-booking gross at checkout time (the wallet may reduce the actual
 * Razorpay charge — allocations live in per-booking audit rows).
 *
 * The order is an ENVELOPE, not a money engine: commission / tax /
 * cancellation / payout stay per-Booking (ADR-0021 — payout batching and
 * refunds read Booking snapshots, never this table).
 *
 * Mirrored by hand-authored db/migrations/0036_checkout_orders.sql; this
 * drizzle definition also drives the e2e DB via drizzle-kit push — both
 * must stay in lockstep.
 */

export const orderStateEnum = pgEnum('order_state', ['created', 'paid'])

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerUserId: text('customer_user_id')
    .references(() => users.id, { onDelete: 'restrict' })
    .notNull(),
  /** Set post-commit when the Razorpay order is created (wallet may cover 100%). */
  razorpayOrderId: text('razorpay_order_id').unique(),
  amountTotalSnapshot: numeric('amount_total_snapshot', {
    precision: 14,
    scale: 2,
  }).notNull(),
  // NOTE: updated_at doubles as the paid-instant proxy (revenue windows in
  // lib/vendor/dashboard-loader.ts) — the paid flip is the last writer
  // today. Any future post-paid UPDATE must add a dedicated paid_at first.
  state: orderStateEnum('state').default('created').notNull(),
  ...timestamps,
})

export type Order = typeof orders.$inferSelect
