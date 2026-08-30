import { sql } from 'drizzle-orm'
import {
  check,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'

import { timestamps } from './_common'
import { users } from './users'

/**
 * Wallet balance buckets per ADR-0004. The single "wallet" Customer UI
 * is backed by TWO buckets with different accounting types:
 *
 *  - switchback_credit  — closed-loop promotional balance (referral
 *                       credit, festive promo credit, loyalty rewards).
 *                       Never cashable. Expires 12–18 months from issue.
 *  - refund_balance  — closed-loop by default but cashable on Customer
 *                       request (5–7 day Razorpay round-trip). Real
 *                       liability on the books.
 *
 * Spend order at Booking checkout (also per ADR-0004):
 *   1. switchback_credit (expires)
 *   2. refund_balance (cashout optionality)
 *   3. Razorpay charge for the remainder
 */
export const walletBalanceTypeEnum = pgEnum('wallet_balance_type', [
  'switchback_credit',
  'refund_balance',
])

export const walletBalances = pgTable(
  'wallet_balances',
  {
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    balanceType: walletBalanceTypeEnum('balance_type').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).default('0.00').notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.balanceType] }),
    check('wallet_amount_non_negative', sql`${t.amount} >= 0`),
  ],
)

export type WalletBalance = typeof walletBalances.$inferSelect
export type NewWalletBalance = typeof walletBalances.$inferInsert
