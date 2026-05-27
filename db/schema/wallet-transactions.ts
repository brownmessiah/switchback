import { sql } from 'drizzle-orm'
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * Wallet transaction ledger per ADR-0004. Every wallet movement — credit
 * grant, checkout deduction, refund credit, promo redemption, admin
 * adjustment, expiry — is an immutable row here.
 *
 * The aggregate `wallet_balances` table stores the running total for
 * fast reads; this ledger is the audit spine that backs reconciliation.
 *
 * `amount` is signed: positive = credit, negative = debit. This
 * simplifies the balance-from-ledger computation to a simple SUM
 * grouped by balance_type.
 */
export const walletTransactionSourceEnum = pgEnum('wallet_transaction_source', [
  'promo',
  'referral',
  'refund',
  'admin',
  'checkout_deduction',
  'expiry',
])

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    balanceType: text('balance_type').notNull(), // reuses 'outvers_credit' | 'refund_balance'
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    source: walletTransactionSourceEnum('source').notNull(),
    referenceId: text('reference_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('wallet_txn_by_user').on(t.userId),
    index('wallet_txn_by_user_type').on(t.userId, t.balanceType),
    index('wallet_txn_by_source').on(t.source),
    index('wallet_txn_by_created').on(t.createdAt),
  ],
)

export type WalletTransaction = typeof walletTransactions.$inferSelect
export type NewWalletTransaction = typeof walletTransactions.$inferInsert
